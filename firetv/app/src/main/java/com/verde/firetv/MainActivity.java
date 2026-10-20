package com.verde.firetv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * VER-DÉ for Fire TV.
 *
 * A Fire OS host for the VER-DÉ 2.0 AI Cinema Engine's 10-foot interface (tv.html).
 * The engine — catalog, Gemini-backed intent understanding, recommendation — lives on the
 * web so the same intelligence serves web and TV. This app supplies what the TV needs:
 * a full-screen WebView, remote Back-key handling routed into VER-DÉ's own navigation,
 * autoplay for film playback, and a Fire TV home-screen banner.
 */
public class MainActivity extends Activity {

    private static final String TV_URL = "https://engine.ver-de.com/tv.html?app=1";
    private static final String ENGINE_HOST = "engine.ver-de.com";

    private FrameLayout root;
    private WebView webView;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private boolean showingOffline = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(8, 10, 8));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(8, 10, 8));
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);              // household memory lives in localStorage
        s.setMediaPlaybackRequiresUserGesture(false); // OK on the remote starts the film with sound
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " VERDE-FireTV/1.0");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // The film player (an embedded frame) must load freely; only page-level navigation is held.
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                // Stay inside VER-DÉ; ignore navigation away from the engine on a TV with no browser chrome.
                return uri == null || !ENGINE_HOST.equals(uri.getHost());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                // Player's own full-screen button.
                if (customView != null) { callback.onCustomViewHidden(); return; }
                customView = view;
                customViewCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                webView.setVisibility(View.GONE);
            }

            @Override
            public void onHideCustomView() {
                exitCustomView();
            }
        });

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        hideSystemUi();

        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
        else webView.loadUrl(TV_URL);
        webView.requestFocus();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();

        if (code == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_UP) handleBack();
            return true;
        }

        if (showingOffline && event.getAction() == KeyEvent.ACTION_UP
                && (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER)) {
            showingOffline = false;
            webView.loadUrl(TV_URL);
            return true;
        }

        return super.dispatchKeyEvent(event);
    }

    /** Back closes the player, then steps back through VER-DÉ's screens, then leaves the app. */
    private void handleBack() {
        if (customView != null) { exitCustomView(); return; }
        if (showingOffline) { finish(); return; }
        webView.evaluateJavascript(
                "(function(){try{return window.verdeBack?String(window.verdeBack()):'false';}catch(e){return 'false';}})()",
                value -> {
                    if (value == null || value.contains("false")) finish();
                });
    }

    private void exitCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        webView.setVisibility(View.VISIBLE);
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
        webView.requestFocus();
    }

    private void showOffline() {
        showingOffline = true;
        String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width'>"
                + "<style>html,body{margin:0;height:100%;background:#080A08;color:#E9E7DE;"
                + "font-family:sans-serif;display:flex;align-items:center;justify-content:center;text-align:center}"
                + "h1{font-size:5vw;letter-spacing:.16em;margin:0}h1 span{color:#4E8C63}"
                + "p{font-size:2vw;color:#8E998F;margin:2vw 0 0}</style></head><body><div>"
                + "<h1>VER<span>-</span>DÉ</h1>"
                + "<p>VER-DÉ can't reach the internet right now.</p>"
                + "<p>Check the Fire TV's Wi-Fi, then press OK to try again.</p>"
                + "</div></body></html>";
        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        hideSystemUi();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }
}
