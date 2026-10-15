package dev.rildo.figurinhas.whatsapp;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Ponte JS → WhatsApp. Mesmo fluxo do exemplo oficial e do Sticker.ly: os arquivos ficam no app,
 * o StickerContentProvider os entrega, e o intent ENABLE_STICKER_PACK abre o "Adicionar pacote".
 */
@CapacitorPlugin(name = "WhatsAppStickers")
public class WhatsAppStickersPlugin extends Plugin {

    private static final String CONSUMER = "com.whatsapp";
    private static final String BUSINESS = "com.whatsapp.w4b";

    private boolean isInstalled(String packageName) {
        try {
            ApplicationInfo info = getContext().getPackageManager().getApplicationInfo(packageName, 0);
            return info.enabled;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("whatsapp", isInstalled(CONSUMER));
        result.put("business", isInstalled(BUSINESS));
        call.resolve(result);
    }

    /** Recebe um arquivo por vez (base64), para não passar o pacote inteiro numa só mensagem. */
    @PluginMethod
    public void writePackFile(PluginCall call) {
        String identifier = call.getString("identifier");
        String name = call.getString("name");
        String data = call.getString("data");
        if (identifier == null || name == null || data == null) {
            call.reject("identifier, name e data são obrigatórios", "INVALID_ARGUMENT");
            return;
        }
        try {
            PackStore.writeFile(getContext(), identifier, name, Base64.decode(data, Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), "WRITE_FAILED", e);
        }
    }

    @PluginMethod
    public void addPack(PluginCall call) {
        PackStore.Pack pack;
        try {
            pack = PackStore.fromJson(call.getData());
            PackStore.saveMeta(getContext(), pack);
        } catch (Exception e) {
            call.reject(e.getMessage(), "INVALID_PACK", e);
            return;
        }

        boolean consumer = isInstalled(CONSUMER);
        boolean business = isInstalled(BUSINESS);
        if (!consumer && !business) {
            call.reject("WhatsApp não está instalado", "WHATSAPP_NOT_INSTALLED");
            return;
        }

        Intent intent = new Intent("com.whatsapp.intent.action.ENABLE_STICKER_PACK");
        intent.putExtra("sticker_pack_id", pack.identifier);
        intent.putExtra("sticker_pack_authority", StickerContentProvider.authority(getContext()));
        intent.putExtra("sticker_pack_name", pack.name);

        String target = call.getString("target");
        if ("business".equals(target) && business) intent.setPackage(BUSINESS);
        else if ("whatsapp".equals(target) && consumer) intent.setPackage(CONSUMER);
        else if (consumer != business) intent.setPackage(consumer ? CONSUMER : BUSINESS);
        // Com os dois instalados e sem alvo, o sistema pergunta qual usar.
        Intent launch = intent.getPackage() == null ? Intent.createChooser(intent, "Adicionar ao WhatsApp") : intent;

        try {
            startActivityForResult(call, launch, "onAddPackResult");
        } catch (ActivityNotFoundException e) {
            call.reject("Atualize o WhatsApp para adicionar pacotes", "WHATSAPP_OUTDATED", e);
        }
    }

    @ActivityCallback
    private void onAddPackResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject out = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK) {
            out.put("status", "added");
            call.resolve(out);
            return;
        }
        Intent data = result.getData();
        String validationError = data != null ? data.getStringExtra("validation_error") : null;
        if (validationError != null) {
            call.reject(validationError, "VALIDATION_ERROR");
            return;
        }
        out.put("status", "cancelled");
        call.resolve(out);
    }

    /** Consulta o próprio WhatsApp para saber se o pacote já foi adicionado. */
    @PluginMethod
    public void isPackAdded(PluginCall call) {
        String identifier = call.getString("identifier");
        if (identifier == null) {
            call.reject("identifier é obrigatório", "INVALID_ARGUMENT");
            return;
        }
        Context context = getContext();
        boolean consumer = isInstalled(CONSUMER);
        boolean business = isInstalled(BUSINESS);
        JSObject result = new JSObject();
        result.put("whatsapp", consumer && isWhitelisted(context, CONSUMER, identifier));
        result.put("business", business && isWhitelisted(context, BUSINESS, identifier));
        result.put("added", (consumer || business) && (!consumer || result.getBool("whatsapp")) && (!business || result.getBool("business")));
        call.resolve(result);
    }

    private static boolean isWhitelisted(Context context, String whatsappPackage, String identifier) {
        String authority = whatsappPackage + ".provider.sticker_whitelist_check";
        ProviderInfo info = context.getPackageManager().resolveContentProvider(authority, PackageManager.GET_META_DATA);
        if (info == null) return false;
        Uri uri = new Uri.Builder()
            .scheme(ContentResolver.SCHEME_CONTENT)
            .authority(authority)
            .appendPath("is_whitelisted")
            .appendQueryParameter("authority", StickerContentProvider.authority(context))
            .appendQueryParameter("identifier", identifier)
            .build();
        try (Cursor cursor = context.getContentResolver().query(uri, null, null, null, null)) {
            return cursor != null && cursor.moveToFirst() && cursor.getInt(cursor.getColumnIndexOrThrow("result")) == 1;
        } catch (Exception e) {
            return false;
        }
    }
}
