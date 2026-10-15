package dev.rildo.figurinhas.whatsapp;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Pacotes exportados para o WhatsApp, guardados em files/whatsapp_packs/&lt;id&gt;/.
 * Cada pasta tem um pack.json com os metadados e os arquivos tray.png e NN.webp.
 */
public final class PackStore {

    static final String TRAY_FILE = "tray.png";
    private static final String META_FILE = "pack.json";
    private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z0-9._-]{1,128}");

    public static final class Sticker {
        public final String file;
        public final List<String> emojis;

        Sticker(String file, List<String> emojis) {
            this.file = file;
            this.emojis = emojis;
        }
    }

    public static final class Pack {
        public final String identifier;
        public final String name;
        public final String publisher;
        public final String imageDataVersion;
        public final boolean animated;
        public final List<Sticker> stickers;

        Pack(String identifier, String name, String publisher, String imageDataVersion, boolean animated, List<Sticker> stickers) {
            this.identifier = identifier;
            this.name = name;
            this.publisher = publisher;
            this.imageDataVersion = imageDataVersion;
            this.animated = animated;
            this.stickers = stickers;
        }
    }

    private PackStore() {}

    /** Recusa nomes que poderiam sair da pasta do pacote. */
    static boolean isSafeName(@Nullable String name) {
        return name != null && SAFE_NAME.matcher(name).matches() && !name.equals(".") && !name.equals("..");
    }

    static File root(@NonNull Context context) {
        return new File(context.getFilesDir(), "whatsapp_packs");
    }

    static File packDir(@NonNull Context context, @NonNull String identifier) {
        if (!isSafeName(identifier)) throw new IllegalArgumentException("Identificador inválido: " + identifier);
        return new File(root(context), identifier);
    }

    @Nullable
    static File file(@NonNull Context context, @NonNull String identifier, @NonNull String name) {
        if (!isSafeName(identifier) || !isSafeName(name)) return null;
        File f = new File(packDir(context, identifier), name);
        return f.isFile() ? f : null;
    }

    static void writeFile(@NonNull Context context, @NonNull String identifier, @NonNull String name, @NonNull byte[] data) throws IOException {
        if (!isSafeName(name)) throw new IllegalArgumentException("Nome de arquivo inválido: " + name);
        File dir = packDir(context, identifier);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Não foi possível criar " + dir);
        File tmp = new File(dir, name + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(data);
        }
        File target = new File(dir, name);
        if (!tmp.renameTo(target)) throw new IOException("Não foi possível salvar " + name);
    }

    /** Grava os metadados e apaga arquivos que não fazem mais parte do pacote. */
    static void saveMeta(@NonNull Context context, @NonNull Pack pack) throws IOException, JSONException {
        JSONObject json = new JSONObject();
        json.put("identifier", pack.identifier);
        json.put("name", pack.name);
        json.put("publisher", pack.publisher);
        json.put("imageDataVersion", pack.imageDataVersion);
        json.put("animated", pack.animated);
        JSONArray stickers = new JSONArray();
        Set<String> keep = new HashSet<>();
        keep.add(TRAY_FILE);
        keep.add(META_FILE);
        for (Sticker s : pack.stickers) {
            if (!isSafeName(s.file)) throw new IllegalArgumentException("Nome de arquivo inválido: " + s.file);
            JSONObject item = new JSONObject();
            item.put("file", s.file);
            item.put("emojis", new JSONArray(s.emojis));
            stickers.put(item);
            keep.add(s.file);
        }
        json.put("stickers", stickers);
        writeFile(context, pack.identifier, META_FILE, json.toString().getBytes(StandardCharsets.UTF_8));

        File[] files = packDir(context, pack.identifier).listFiles();
        if (files != null) {
            for (File f : files) {
                if (!keep.contains(f.getName())) //noinspection ResultOfMethodCallIgnored
                    f.delete();
            }
        }
    }

    @Nullable
    static Pack read(@NonNull Context context, @NonNull String identifier) {
        if (!isSafeName(identifier)) return null;
        File meta = new File(packDir(context, identifier), META_FILE);
        if (!meta.isFile()) return null;
        try {
            return fromJson(new JSONObject(new String(Files.readAllBytes(meta.toPath()), StandardCharsets.UTF_8)));
        } catch (IOException | JSONException e) {
            return null;
        }
    }

    static List<Pack> readAll(@NonNull Context context) {
        List<Pack> packs = new ArrayList<>();
        File[] dirs = root(context).listFiles(File::isDirectory);
        if (dirs == null) return packs;
        for (File dir : dirs) {
            Pack pack = read(context, dir.getName());
            if (pack != null) packs.add(pack);
        }
        return packs;
    }

    static Pack fromJson(@NonNull JSONObject json) throws JSONException {
        JSONArray items = json.getJSONArray("stickers");
        List<Sticker> stickers = new ArrayList<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.getJSONObject(i);
            JSONArray emojiArray = item.optJSONArray("emojis");
            List<String> emojis = new ArrayList<>();
            if (emojiArray != null) {
                for (int j = 0; j < emojiArray.length(); j++) emojis.add(emojiArray.getString(j));
            }
            stickers.add(new Sticker(item.getString("file"), emojis));
        }
        return new Pack(
            json.getString("identifier"),
            json.getString("name"),
            json.optString("publisher", ""),
            json.getString("imageDataVersion"),
            json.optBoolean("animated", false),
            stickers
        );
    }
}
