package ir.expensescan.hesabyar;

import android.os.Bundle;
import android.view.WindowManager;
import android.view.View;
import android.graphics.Color;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LedgerStoragePlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        // Android 15 enforces edge-to-edge for target SDK 35. Reserve the actual
        // system bars, display cutout and IME at the native root, once.
        WindowCompat.setDecorFitsSystemWindows(getWindow(),false);
        View content=findViewById(android.R.id.content);
        content.setBackgroundColor(Color.rgb(248,250,252));
        WindowCompat.getInsetsController(getWindow(),content).setAppearanceLightStatusBars(true);
        WindowCompat.getInsetsController(getWindow(),content).setAppearanceLightNavigationBars(true);
        ViewCompat.setOnApplyWindowInsetsListener(content,(view,insets)->{
            Insets safe=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout());
            Insets ime=insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(safe.left,safe.top,safe.right,Math.max(safe.bottom,ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(content);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new Event('expensescan-native-back'))", null);
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }
}
