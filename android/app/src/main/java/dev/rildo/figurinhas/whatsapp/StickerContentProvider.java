package dev.rildo.figurinhas.whatsapp;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.text.TextUtils;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import java.io.File;
import java.io.FileNotFoundException;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

/**
 * Interface lida pelo WhatsApp (contrato de github.com/WhatsApp/stickers). Os nomes de colunas e
 * caminhos não podem mudar. Diferente do exemplo oficial, os pacotes vêm do armazenamento do app
 * (criados pelo usuário), não de assets fixos.
 */
public class StickerContentProvider extends ContentProvider {

    public static final String AUTHORITY_SUFFIX = ".stickercontentprovider";

    private static final String METADATA = "metadata";
    private static final String STICKERS = "stickers";
    private static final String STICKERS_ASSET = "stickers_asset";

    private static final String[] PACK_COLUMNS = {
        "sticker_pack_identifier",
        "sticker_pack_name",
        "sticker_pack_publisher",
        "sticker_pack_icon",
        "android_play_store_link",
        "ios_app_download_link",
        "sticker_pack_publisher_email",
        "sticker_pack_publisher_website",
        "sticker_pack_privacy_policy_website",
        "sticker_pack_license_agreement_website",
        "image_data_version",
        "whatsapp_will_not_cache_stickers",
        "animated_sticker_pack",
    };

    private static final String[] STICKER_COLUMNS = {"sticker_file_name", "sticker_emoji", "sticker_accessibility_text"};

    public static String authority(@NonNull Context context) {
        return context.getPackageName() + AUTHORITY_SUFFIX;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    private Context ctx() {
        return Objects.requireNonNull(getContext());
    }

    @Nullable
    @Override
    public Cursor query(@NonNull Uri uri, @Nullable String[] projection, @Nullable String selection, @Nullable String[] selectionArgs, @Nullable String sortOrder) {
        List<String> segments = uri.getPathSegments();
        if (segments.size() == 1 && METADATA.equals(segments.get(0))) {
            return packCursor(uri, PackStore.readAll(ctx()));
        }
        if (segments.size() == 2 && METADATA.equals(segments.get(0))) {
            PackStore.Pack pack = PackStore.read(ctx(), segments.get(1));
            return packCursor(uri, pack == null ? Collections.emptyList() : Collections.singletonList(pack));
        }
        if (segments.size() == 2 && STICKERS.equals(segments.get(0))) {
            MatrixCursor cursor = new MatrixCursor(STICKER_COLUMNS);
            PackStore.Pack pack = PackStore.read(ctx(), segments.get(1));
            if (pack != null) {
                for (PackStore.Sticker sticker : pack.stickers) {
                    cursor.addRow(new Object[] {sticker.file, TextUtils.join(",", sticker.emojis), null});
                }
            }
            cursor.setNotificationUri(ctx().getContentResolver(), uri);
            return cursor;
        }
        throw new IllegalArgumentException("URI desconhecida: " + uri);
    }

    private Cursor packCursor(@NonNull Uri uri, @NonNull List<PackStore.Pack> packs) {
        MatrixCursor cursor = new MatrixCursor(PACK_COLUMNS);
        for (PackStore.Pack pack : packs) {
            cursor.newRow()
                .add(pack.identifier)
                .add(pack.name)
                .add(pack.publisher)
                .add(PackStore.TRAY_FILE)
                .add("")
                .add("")
                .add("")
                .add("https://stickers.rildo.dev")
                .add("")
                .add("")
                .add(pack.imageDataVersion)
                .add(0)
                .add(pack.animated ? 1 : 0);
        }
        cursor.setNotificationUri(ctx().getContentResolver(), uri);
        return cursor;
    }

    @Nullable
    @Override
    public AssetFileDescriptor openAssetFile(@NonNull Uri uri, @NonNull String mode) throws FileNotFoundException {
        List<String> segments = uri.getPathSegments();
        if (segments.size() != 3 || !STICKERS_ASSET.equals(segments.get(0))) {
            throw new FileNotFoundException("URI desconhecida: " + uri);
        }
        String identifier = segments.get(1);
        String name = segments.get(2);
        PackStore.Pack pack = PackStore.read(ctx(), identifier);
        if (pack == null) throw new FileNotFoundException("Pacote não encontrado: " + identifier);
        // Só entrega arquivos que pertencem ao pacote.
        boolean listed = PackStore.TRAY_FILE.equals(name);
        for (PackStore.Sticker sticker : pack.stickers) listed |= sticker.file.equals(name);
        File file = listed ? PackStore.file(ctx(), identifier, name) : null;
        if (file == null) throw new FileNotFoundException("Arquivo não encontrado: " + name);
        return new AssetFileDescriptor(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY), 0, AssetFileDescriptor.UNKNOWN_LENGTH);
    }

    @Override
    public String getType(@NonNull Uri uri) {
        List<String> segments = uri.getPathSegments();
        String authority = authority(ctx());
        if (segments.size() == 1 && METADATA.equals(segments.get(0))) return "vnd.android.cursor.dir/vnd." + authority + "." + METADATA;
        if (segments.size() == 2 && METADATA.equals(segments.get(0))) return "vnd.android.cursor.item/vnd." + authority + "." + METADATA;
        if (segments.size() == 2 && STICKERS.equals(segments.get(0))) return "vnd.android.cursor.dir/vnd." + authority + "." + STICKERS;
        if (segments.size() == 3 && STICKERS_ASSET.equals(segments.get(0))) {
            return PackStore.TRAY_FILE.equals(segments.get(2)) ? "image/png" : "image/webp";
        }
        throw new IllegalArgumentException("URI desconhecida: " + uri);
    }

    @Nullable
    @Override
    public Uri insert(@NonNull Uri uri, @Nullable ContentValues values) {
        throw new UnsupportedOperationException("Somente leitura");
    }

    @Override
    public int delete(@NonNull Uri uri, @Nullable String selection, @Nullable String[] selectionArgs) {
        throw new UnsupportedOperationException("Somente leitura");
    }

    @Override
    public int update(@NonNull Uri uri, @Nullable ContentValues values, @Nullable String selection, @Nullable String[] selectionArgs) {
        throw new UnsupportedOperationException("Somente leitura");
    }
}
