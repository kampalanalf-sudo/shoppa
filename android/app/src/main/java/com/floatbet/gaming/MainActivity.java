package com.floatbet.gaming;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * FloatBet's Android entry point.
 *
 * Everything Capacitor does is left alone. The one addition is the native bridge,
 * which is what makes the SMS and location permissions the product asked for
 * actually do something: a permission declared in the manifest and never used is
 * a permission we asked the player for and then wasted.
 *
 * See NativeBridge for exactly what is read and what is refused.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                // `FloatBetNative` is the name the web layer looks for. Adding it
                // after the bridge is created means the page's own scripts are
                // already defined, so nothing is overwritten.
                webView.addJavascriptInterface(new NativeBridge(this), "FloatBetNative");
            }
        } catch (Exception ignored) {
            // A bridge that cannot be attached must not stop the app opening: the
            // web layer checks for `window.FloatBetNative` and simply runs without
            // it (deposits still work; they just cannot be confirmed from an SMS).
        }
    }
}
