package dev.rildo.figurinhas;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import dev.rildo.figurinhas.whatsapp.WhatsAppStickersPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins locais precisam ser registrados antes do super.onCreate.
        registerPlugin(WhatsAppStickersPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
