package com.mrscrap.socialradar;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.Nullable;

/** Dedicated first-party Instagram login surface. Credentials stay on instagram.com. */
public class InstagramSessionActivity extends Activity {
    private static final int COLOR_CHROME = Color.rgb(2, 6, 23);
    private static final int COLOR_TEXT = Color.rgb(241, 245, 249);
    private static final int COLOR_MUTED = Color.rgb(148, 163, 184);
    private static final int COLOR_ACCENT = Color.rgb(6, 182, 212);

    private WebView webView;
    private ProgressBar progressBar;
    private boolean completed = false;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        WebView.setWebContentsDebuggingEnabled(false);
        getWindow().setStatusBarColor(COLOR_CHROME);
        getWindow().setNavigationBarColor(COLOR_CHROME);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setBackgroundColor(COLOR_CHROME);
        toolbar.setPadding(dp(8), 0, dp(8), 0);
        toolbar.setLayoutDirection(View.LAYOUT_DIRECTION_LTR);

        TextView back = chromeButton("‹", 34);
        back.setContentDescription("Back");
        back.setOnClickListener(v -> navigateBackOrClose());

        TextView title = new TextView(this);
        title.setText("Instagram");
        title.setTextColor(COLOR_TEXT);
        title.setTextSize(16);
        title.setGravity(Gravity.CENTER_VERTICAL);
        title.setSingleLine(true);
        title.setPadding(dp(6), 0, dp(6), 0);

        TextView privacy = new TextView(this);
        privacy.setText("MR SCRAP");
        privacy.setTextColor(COLOR_MUTED);
        privacy.setTextSize(11);
        privacy.setGravity(Gravity.CENTER_VERTICAL | Gravity.END);
        privacy.setSingleLine(true);

        TextView close = chromeButton("×", 27);
        close.setContentDescription("Close Instagram login");
        close.setOnClickListener(v -> finish());

        toolbar.addView(back, new LinearLayout.LayoutParams(dp(44), dp(52)));
        toolbar.addView(title, new LinearLayout.LayoutParams(0, dp(52), 1f));
        toolbar.addView(privacy, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(52)));
        toolbar.addView(close, new LinearLayout.LayoutParams(dp(44), dp(52)));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setIndeterminate(true);
        progressBar.getIndeterminateDrawable().setTint(COLOR_ACCENT);

        FrameLayout webContainer = new FrameLayout(this);
        webView = new WebView(this);
        webContainer.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                String host = request.getUrl().getHost();
                if (host == null) return true;
                String normalized = host.toLowerCase();
                boolean instagram = normalized.equals("instagram.com") || normalized.endsWith(".instagram.com") ||
                    normalized.equals("instagr.am") || normalized.endsWith(".instagr.am");
                // Instagram can offer "Continue with Facebook" during authentication.
                boolean facebook = normalized.equals("facebook.com") || normalized.endsWith(".facebook.com") ||
                    normalized.equals("fb.com") || normalized.endsWith(".fb.com");
                return !(instagram || facebook);
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (progressBar != null) progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (progressBar != null) progressBar.setVisibility(View.GONE);
                completeIfAuthenticated();
            }
        });

        root.addView(toolbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
        root.addView(progressBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2)));
        root.addView(webContainer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        webView.loadUrl(SessionStateStore.isInstagramConnected()
            ? "https://www.instagram.com/"
            : "https://www.instagram.com/accounts/login/");
    }

    private TextView chromeButton(String glyph, float sizeSp) {
        TextView button = new TextView(this);
        button.setText(glyph);
        button.setTextColor(COLOR_TEXT);
        button.setTextSize(sizeSp);
        button.setGravity(Gravity.CENTER);
        button.setBackground(pressSurface());
        button.setClickable(true);
        button.setFocusable(true);
        return button;
    }

    private GradientDrawable pressSurface() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(Color.TRANSPARENT);
        drawable.setCornerRadius(dp(12));
        return drawable;
    }

    private void completeIfAuthenticated() {
        if (completed) return;
        CookieManager.getInstance().flush();
        if (!SessionStateStore.isInstagramConnected()) return;
        completed = true;
        SessionStateStore.markInstagramConnected(this);
        setResult(RESULT_OK);
        finish();
    }

    private void navigateBackOrClose() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else finish();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        navigateBackOrClose();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
