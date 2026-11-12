#!/usr/bin/env python3
"""Install Bite native owner-order alerts in the generated Capacitor Android app.

This supports notifications while the live-order WebView is active; it is NOT
Firebase push messaging for a fully stopped application.
"""
from pathlib import Path
import re

java_roots=list(Path("android/app/src/main/java").rglob("MainActivity.java"))
if len(java_roots)!=1:
    raise SystemExit("Exactly one MainActivity.java is required")
activity=java_roots[0]
old=activity.read_text()
if "extends BridgeActivity" not in old or "onCreate(" in old:
    raise SystemExit("Unexpected Capacitor MainActivity; refusing patch")
m=re.search(r"^\s*package\s+([\w.]+);",old,re.M)
if not m:
    raise SystemExit("Cannot determine Android Java package")
package=m.group(1)
method="""
  @Override
  public void onCreate(android.os.Bundle savedInstanceState) {
    registerPlugin(BiteOrderAlertsPlugin.class);
    super.onCreate(savedInstanceState);
    android.webkit.WebView webView=getBridge().getWebView();
    if(webView != null){
      // Keep HTTPS origin + DOM storage stable across app restarts.
      // Never clear WebView cache/data, cookies, localStorage, or login sessions.
      webView.getSettings().setDomStorageEnabled(true);
      webView.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_DEFAULT);
      // Session recovery can also depend on Android WebView's HTTPS cookies.
      // Do not delete user cookies or app data on activity recreation.
      android.webkit.CookieManager.getInstance().setAcceptCookie(true);
      webView.setSaveEnabled(true);
    }
  }
"""
activity.write_text(old[:old.rfind("}")]+method+old[old.rfind("}"):])
manifest=Path("android/app/src/main/AndroidManifest.xml")
man=manifest.read_text()
permission='<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'
if permission not in man:
    man=man.replace("<application",permission+"\n    <application",1)
manifest.write_text(man)

code=r'''package PACKAGE;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name="BiteOrderAlerts",
  permissions={@Permission(alias="notifications",
    strings={Manifest.permission.POST_NOTIFICATIONS})})
public class BiteOrderAlertsPlugin extends Plugin {
  private static final String CHANNEL_ID="bite_owner_new_orders_v1";

  @PluginMethod
  public void enable(PluginCall call) {
    if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
      requestPermissionForAlias("notifications",call,"afterPermission");
    } else {
      JSObject out=new JSObject();
      out.put("granted",true);
      call.resolve(out);
    }
  }

  @PermissionCallback
  private void afterPermission(PluginCall call) {
    boolean granted=Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED;
    JSObject out=new JSObject();
    out.put("granted",granted);
    call.resolve(out);
  }

  @PluginMethod
  public void notifyOrder(PluginCall call) {
    if (Build.VERSION.SDK_INT >= 33
      && ContextCompat.checkSelfPermission(getContext(),Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      call.reject("Enable Android notification permission first");
      return;
    }
    String id=call.getString("orderId","");
    if(id.isEmpty() || id.length()>128){
      call.reject("Invalid order identifier");
      return;
    }
    String title=call.getString("title","New Bite order");
    String body=call.getString("body","Open Bite Partner to accept the order");
    if(title.length()>80)title=title.substring(0,80);
    if(body.length()>180)body=body.substring(0,180);
    NotificationManager nm=(NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    if(nm==null){call.reject("Android notification manager unavailable");return;}
    if(Build.VERSION.SDK_INT>=26 && nm.getNotificationChannel(CHANNEL_ID)==null){
      NotificationChannel channel=new NotificationChannel(CHANNEL_ID,"New restaurant orders",NotificationManager.IMPORTANCE_HIGH);
      channel.enableVibration(true);
      nm.createNotificationChannel(channel);
    }
    Intent intent=new Intent(getContext(),getActivity().getClass());
    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent open=PendingIntent.getActivity(getContext(),0,intent,
      PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    Notification.Builder builder=Build.VERSION.SDK_INT>=26
      ? new Notification.Builder(getContext(),CHANNEL_ID)
      : new Notification.Builder(getContext());
    builder.setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle(title).setContentText(body)
      .setContentIntent(open).setAutoCancel(true);
    if(Build.VERSION.SDK_INT<26)builder.setDefaults(Notification.DEFAULT_SOUND|Notification.DEFAULT_VIBRATE);
    nm.notify(id.hashCode() & 0x7fffffff,builder.build());
    JSObject out=new JSObject();out.put("shown",true);call.resolve(out);
  }
}
'''
plugin=activity.parent/"BiteOrderAlertsPlugin.java"
plugin.write_text(code.replace("PACKAGE",package,1))
print("Installed persistent WebView + active WebView notification bridge",plugin)

# Partner-only Android share intent opens WhatsApp even when the handoff link
# was asynchronously generated. No about:blank tab, no browser redirect.
if package == "in.bite.partner":
    updated_main = activity.read_text()
    plugin_line = "registerPlugin(BiteOrderAlertsPlugin.class);"
    if plugin_line not in updated_main:
        raise SystemExit("Expected native alert registration missing")
    updated_main = updated_main.replace(
        plugin_line,
        plugin_line + "\\n    registerPlugin(BiteDeliverySharePlugin.class);",
        1,
    )
    activity.write_text(updated_main)

    share_plugin = r'''package PACKAGE;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name="BiteDeliveryShare")
public class BiteDeliverySharePlugin extends Plugin {
  @PluginMethod
  public void shareText(PluginCall call) {
    String message = call.getString("text", "");
    if (message == null || message.isEmpty() || message.length() > 12000) {
      call.reject("Invalid delivery share message");
      return;
    }
    getActivity().runOnUiThread(() -> {
      try {
        if (tryWhatsApp("com.whatsapp", message)
            || tryWhatsApp("com.whatsapp.w4b", message)) {
          call.resolve();
          return;
        }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, message);
        getActivity().startActivity(Intent.createChooser(send, "Share Bite delivery link"));
        call.resolve();
      } catch (Exception e) {
        call.reject("Android share app unavailable");
      }
    });
  }
  private boolean tryWhatsApp(String packageName, String message) {
    Intent intent = new Intent(Intent.ACTION_SEND);
    intent.setType("text/plain");
    intent.putExtra(Intent.EXTRA_TEXT, message);
    intent.setPackage(packageName);
    try {
      getActivity().startActivity(intent);
      return true;
    } catch (ActivityNotFoundException exception) {
      return false;
    }
  }
}
'''
    (activity.parent / "BiteDeliverySharePlugin.java").write_text(
        share_plugin.replace("PACKAGE", package, 1)
    )
    print("Installed native WhatsApp handoff share plugin")
