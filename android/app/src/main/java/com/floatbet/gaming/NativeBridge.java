package com.floatbet.gaming;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.JavascriptInterface;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The native side of the two permissions the product asked for: SMS and location.
 *
 * WHY THIS EXISTS RATHER THAN A CORDOVA PLUGIN
 *
 * The app is a Capacitor WebView. Plugins are fine, but this is ~120 lines of
 * Android and pulling in a third-party SMS plugin would mean trusting a stranger's
 * code with the ability to read every text message on the player's phone. This is
 * the same surface, written here, where it can be read.
 *
 * WHAT IT DOES WITH SMS, AND WHAT IT REFUSES TO DO
 *
 * The only use is mobile-money confirmation. A deposit is charged by the network
 * and the player is told "check your phone and approve". The confirmation SMS that
 * follows is the network's own evidence that the money moved — reading it lets the
 * app notice a deposit the instant it lands, instead of waiting for the webhook.
 *
 *   * `recentSms()` returns ONLY messages that look like a mobile-money
 *     confirmation (a UGX amount plus the provider's own wording), newest first,
 *     capped at 20. It does not return an inbox dump.
 *   * Sending is never requested and cannot happen: no SEND_SMS permission.
 *   * The reading happens on the phone. Nothing is uploaded by this class; the web
 *     layer decides whether to use a message, and the app only ever uses it to
 *     refresh a balance the server has already credited.
 *   * Nothing is read at all until the player grants the permission and presses
 *     the button that asks for it.
 */
public class NativeBridge {

    private final Activity activity;

    NativeBridge(Activity activity) {
        this.activity = activity;
    }

    /** Which of the two permissions are granted right now. */
    @JavascriptInterface
    public String status() {
        try {
            JSONObject out = new JSONObject();
            out.put("sms", granted(Manifest.permission.READ_SMS));
            out.put("location", granted(Manifest.permission.ACCESS_FINE_LOCATION)
                    || granted(Manifest.permission.ACCESS_COARSE_LOCATION));
            out.put("notifications", Build.VERSION.SDK_INT < 33
                    || granted(Manifest.permission.POST_NOTIFICATIONS));
            out.put("platform", "android");
            out.put("sdk", Build.VERSION.SDK_INT);
            return out.toString();
        } catch (Exception e) {
            return "{\"sms\":false,\"location\":false,\"platform\":\"android\"}";
        }
    }

    /**
     * Ask for a permission. `which` is "sms" or "location".
     *
     * Must run on the UI thread: Android refuses a permission request from
     * anywhere else, and a WebView JavascriptInterface call arrives on a binder
     * thread. That is why this is posted rather than called directly.
     */
    @JavascriptInterface
    public void request(final String which) {
        final String[] wanted;
        if ("sms".equals(which)) {
            wanted = new String[]{Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS};
        } else if ("location".equals(which)) {
            wanted = new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
            };
        } else if ("notifications".equals(which)) {
            if (Build.VERSION.SDK_INT < 33) return;
            wanted = new String[]{Manifest.permission.POST_NOTIFICATIONS};
        } else {
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                ActivityCompat.requestPermissions(activity, wanted, 7101);
            } catch (Exception ignored) {
                // A permission that cannot be asked for is a permission that stays
                // denied; the caller reads that from status().
            }
        });
    }

    /**
     * Mobile-money confirmation messages only, newest first, at most 20.
     *
     * The filter is deliberately narrow. A message qualifies if it contains a
     * shilling amount AND one of the mobile-money provider names, which is what a
     * payment confirmation looks like and what a personal text does not.
     */
    @JavascriptInterface
    public String recentSms() {
        JSONArray rows = new JSONArray();
        if (!granted(Manifest.permission.READ_SMS)) return rows.toString();

        Cursor cursor = null;
        try {
            cursor = activity.getContentResolver().query(
                    Uri.parse("content://sms/inbox"),
                    new String[]{"address", "body", "date"},
                    null, null, "date DESC");
            if (cursor == null) return rows.toString();

            int guard = 0;
            while (cursor.moveToNext() && rows.length() < 20 && guard < 400) {
                guard++;
                String address = cursor.getString(0) == null ? "" : cursor.getString(0);
                String body = cursor.getString(1) == null ? "" : cursor.getString(1);
                long date = cursor.getLong(2);

                if (!looksLikeMoney(body)) continue;

                JSONObject row = new JSONObject();
                row.put("address", address);
                row.put("body", body);
                row.put("date", date);
                rows.put(row);
            }
        } catch (Exception ignored) {
            // A provider that forbids the query returns nothing rather than
            // throwing into the WebView.
        } finally {
            if (cursor != null) cursor.close();
        }
        return rows.toString();
    }

    /**
     * The last known position, or zeros when there is none.
     *
     * Deliberately the LAST KNOWN fix, not a live request: the only thing the app
     * does with it is confirm the player is in the country its payment rails serve.
     * A GPS wake-up for that would be an intrusion with no benefit.
     */
    @JavascriptInterface
    public String location() {
        JSONObject out = new JSONObject();
        try {
            out.put("granted", granted(Manifest.permission.ACCESS_FINE_LOCATION)
                    || granted(Manifest.permission.ACCESS_COARSE_LOCATION));
            if (!out.getBoolean("granted")) {
                out.put("ok", false);
                return out.toString();
            }

            LocationManager lm = (LocationManager) activity.getSystemService(Activity.LOCATION_SERVICE);
            Location best = null;
            for (String provider : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER}) {
                try {
                    Location l = lm.getLastKnownLocation(provider);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                } catch (SecurityException | IllegalArgumentException ignored) {
                    // provider off or not permitted: try the next
                }
            }

            if (best == null) {
                out.put("ok", false);
            } else {
                out.put("ok", true);
                out.put("lat", best.getLatitude());
                out.put("lng", best.getLongitude());
                out.put("accuracy", best.getAccuracy());
                out.put("age_ms", System.currentTimeMillis() - best.getTime());
            }
            return out.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"granted\":false}";
        }
    }

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(activity, permission)
                == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean looksLikeMoney(String body) {
        if (body == null || body.isEmpty()) return false;
        String lower = body.toLowerCase();
        boolean provider = lower.contains("mtn") || lower.contains("airtel")
                || lower.contains("zengapay") || lower.contains("floatbet");
        boolean amount = body.matches("(?s).*\\b(UGX|Ugx|ugx)\\s?[0-9][0-9,\\.]*.*")
                || body.matches("(?s).*\\b[0-9][0-9,\\.]*\\s?(UGX|Ugx|ugx).*");
        return provider && amount;
    }
}
