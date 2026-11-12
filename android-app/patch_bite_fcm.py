#!/usr/bin/env python3
"""Optional Firebase Cloud Messaging integration for Bite Partner only.

This script intentionally does nothing without a matching Firebase config;
it must NEVER generate a fake sender ID or commit service credentials.
"""
import base64
import json
import os
import re
from pathlib import Path

encoded = os.environ.get("BITE_FIREBASE_GOOGLE_SERVICES_JSON_BASE64", "").strip()
java_activities = list(Path("android/app/src/main/java").rglob("MainActivity.java"))
if len(java_activities) != 1:
    raise SystemExit("Generated MainActivity missing")
activity = java_activities[0]
main = activity.read_text()
package_match = re.search(r"^\s*package\s+([\w.]+);", main, re.M)
if not package_match:
    raise SystemExit("MainActivity has no package")
package = package_match.group(1)
if package != "in.bite.partner":
    print("FCM is intentionally restricted to Bite Partner APK")
    raise SystemExit(0)
if not encoded:
    print("FCM CONFIG MISSING: Partner APK will keep active-app alerts only.")
    raise SystemExit(0)

try:
    payload = base64.b64decode(encoded, validate=True)
    configuration = json.loads(payload.decode("utf-8"))
except (ValueError, UnicodeError) as exc:
    raise SystemExit("Invalid Firebase Android configuration") from exc
clients = configuration.get("client", [])
if not isinstance(clients, list) or not any(
    c.get("client_info", {}).get("android_client_info", {}).get("package_name") == package
    for c in clients
):
    raise SystemExit("Firebase config must contain Android app in.bite.partner")
if not configuration.get("project_info", {}).get("project_id"):
    raise SystemExit("Firebase project ID missing")
app = Path("android/app")
(app / "google-services.json").write_bytes(payload)

root_gradle = Path("android/build.gradle")
root = root_gradle.read_text()
if "com.google.gms:google-services" not in root:
    buildscript = root.find("buildscript")
    dep = root.find("dependencies {", buildscript)
    if buildscript < 0 or dep < 0:
        raise SystemExit("Unexpected Android root Gradle structure")
    pos = dep + len("dependencies {")
    root = root[:pos] + "\n        classpath 'com.google.gms:google-services:4.5.0'" + root[pos:]
    root_gradle.write_text(root)

app_gradle = app / "build.gradle"
gradle = app_gradle.read_text()
if "com.google.firebase:firebase-messaging" not in gradle:
    dep = gradle.find("dependencies {")
    if dep < 0:
        raise SystemExit("Unexpected Android app Gradle dependencies")
    pos = dep + len("dependencies {")
    gradle = gradle[:pos] + (
        "\n    implementation platform('com.google.firebase:firebase-bom:35.1.0')"
        "\n    implementation 'com.google.firebase:firebase-messaging'"
    ) + gradle[pos:]
if "apply plugin: 'com.google.gms.google-services'" not in gradle:
    gradle += "\napply plugin: 'com.google.gms.google-services'\n"
app_gradle.write_text(gradle)

marker = "registerPlugin(BiteOrderAlertsPlugin.class);"
if marker not in main:
    raise SystemExit("Native notifications plugin must be installed first")
if "registerPlugin(BiteOwnerPushPlugin.class);" not in main:
    main = main.replace(marker, marker + "\n    registerPlugin(BiteOwnerPushPlugin.class);", 1)
channel_statement = """    if (android.os.Build.VERSION.SDK_INT >= 26) {
      android.app.NotificationManager nm = getSystemService(android.app.NotificationManager.class);
      if (nm != null) {
        android.app.NotificationChannel channel = new android.app.NotificationChannel(
          "bite_owner_new_orders_v1", "New restaurant orders",
          android.app.NotificationManager.IMPORTANCE_HIGH);
        channel.enableVibration(true);
        nm.createNotificationChannel(channel);
      }
    }
"""
if 'channel.enableVibration(true);' not in main:
    main = main.replace("super.onCreate(savedInstanceState);", "super.onCreate(savedInstanceState);\n" + channel_statement, 1)
activity.write_text(main)

plugin = r'''package PACKAGE;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

@CapacitorPlugin(name="BiteOwnerPush")
public class BiteOwnerPushPlugin extends Plugin {
  @PluginMethod
  public void enable(PluginCall call) {
    FirebaseMessaging.getInstance().setAutoInitEnabled(true);
    FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
      if (!task.isSuccessful() || task.getResult() == null || task.getResult().isEmpty()) {
        call.reject("FCM token unavailable");
        return;
      }
      JSObject result = new JSObject();
      result.put("token", task.getResult());
      call.resolve(result);
    });
  }

  @PluginMethod
  public void disable(PluginCall call) {
    FirebaseMessaging.getInstance().setAutoInitEnabled(false);
    FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener(task -> {
      if (task.isSuccessful()) call.resolve();
      else call.reject("FCM device token could not be deleted");
    });
  }
}
'''
(activity.parent / "BiteOwnerPushPlugin.java").write_text(plugin.replace("PACKAGE", package, 1))

service_code = r'''package PACKAGE;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

// For foreground notifications; Android renders notification payloads itself in background.
public class BiteFirebaseMessagingService extends FirebaseMessagingService {
  private static final String CHANNEL = "bite_owner_new_orders_v1";
  @Override
  public void onMessageReceived(RemoteMessage message) {
    if (message.getNotification() == null) return;
    if (Build.VERSION.SDK_INT >= 33 &&
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
          != PackageManager.PERMISSION_GRANTED) return;
    NotificationManager manager =
      (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (manager == null) return;
    if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL) == null) {
      NotificationChannel channel =
        new NotificationChannel(CHANNEL, "New restaurant orders", NotificationManager.IMPORTANCE_HIGH);
      channel.enableVibration(true);
      manager.createNotificationChannel(channel);
    }
    String id = message.getData().get("order_id");
    if (id == null || id.isEmpty()) id = message.getMessageId();
    if (id == null || id.isEmpty()) id = "bite-new-order";
    Intent open = new Intent(this, MainActivity.class);
    open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent pending = PendingIntent.getActivity(
      this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle("New Bite order")
      .setContentText("Open Bite Partner to accept or reject.")
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(pending).setAutoCancel(true);
    manager.notify(id.hashCode() & 0x7fffffff, builder.build());
  }
}
'''
(activity.parent / "BiteFirebaseMessagingService.java").write_text(service_code.replace("PACKAGE", package, 1))
manifest = app / "src/main/AndroidManifest.xml"
xml = manifest.read_text()
service_xml = """
        <service android:name=".BiteFirebaseMessagingService"
                 android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>
        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id"
                   android:value="bite_owner_new_orders_v1" />
"""
if "BiteFirebaseMessagingService" not in xml:
    if "</application>" not in xml:
        raise SystemExit("Android application manifest marker missing")
    xml = xml.replace("</application>", service_xml + "    </application>", 1)
    manifest.write_text(xml)
print("FCM compiled into Bite Partner; Firebase config never committed")
