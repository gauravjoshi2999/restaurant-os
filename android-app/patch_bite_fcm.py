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
raw_json = os.environ.get("BITE_FIREBASE_GOOGLE_SERVICES_JSON", "").strip()
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
if not encoded and not raw_json:
    print("FCM CONFIG MISSING: Partner APK will keep active-app alerts only.")
    raise SystemExit(0)

try:
    payload = raw_json.encode("utf-8") if raw_json else base64.b64decode(encoded, validate=True)
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

# Firebase Messaging 26.x requires Android API 24. Only the Partner build
# uses this newer minimum; Customer and Admin builds remain unchanged.
variables_gradle = Path("android/variables.gradle")
variables = variables_gradle.read_text()
old_min_sdk = re.search(r"(minSdkVersion\s*=\s*)(\d+)", variables)
if not old_min_sdk:
    raise SystemExit("Could not locate Android minimum SDK version")
if int(old_min_sdk.group(2)) < 24:
    variables = (variables[:old_min_sdk.start(2)] + "24" + variables[old_min_sdk.end(2):])
    variables_gradle.write_text(variables)
print("FCM compatible Partner Android minSdkVersion:", max(24, int(old_min_sdk.group(2))))

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
if 'void onNewIntent(android.content.Intent intent)' not in main:
    main = main[:main.rfind("}")] + """
  @Override
  protected void onNewIntent(android.content.Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
  }
""" + main[main.rfind("}"):]
activity.write_text(main)

plugin = r'''package PACKAGE;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;
import android.content.Intent;

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
      result.put("supports_order_actions", true);
      call.resolve(result);
    });
  }

  @PluginMethod
  public void consumeOrderAction(PluginCall call) {
    Intent intent=getActivity().getIntent();
    JSObject result=new JSObject();
    if(intent!=null){
      String id=intent.getStringExtra("bite_order_id");
      String restaurant=intent.getStringExtra("bite_restaurant_id");
      String action=intent.getStringExtra("bite_order_action");
      if(id!=null&&restaurant!=null&&("Accepted".equals(action)||"Rejected".equals(action))){
        result.put("order_id",id);
        result.put("restaurant_id",restaurant);
        result.put("action",action);
        intent.removeExtra("bite_order_id");
        intent.removeExtra("bite_restaurant_id");
        intent.removeExtra("bite_order_action");
      }
    }
    call.resolve(result);
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
import java.util.Map;

// New, verified live orders are DATA-only so Android can add owner actions
// while the app is in the background. Legacy APKs receive notification payloads.
public class BiteFirebaseMessagingService extends FirebaseMessagingService {
  private static final String CHANNEL="bite_owner_new_orders_v1";

  private PendingIntent activityIntent(String orderId,String restaurantId,String action) {
    Intent open=new Intent(this,MainActivity.class);
    open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
    open.setAction("in.bite.partner.ORDER_"+action+"_"+orderId);
    open.putExtra("bite_order_id",orderId);
    open.putExtra("bite_restaurant_id",restaurantId);
    if(action!=null)open.putExtra("bite_order_action",action);
    int requestCode=(orderId+":"+action).hashCode() & 0x7fffffff;
    return PendingIntent.getActivity(this,requestCode,open,
      PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  }

  @Override
  public void onMessageReceived(RemoteMessage message) {
    if(Build.VERSION.SDK_INT>=33 &&
      ContextCompat.checkSelfPermission(this,Manifest.permission.POST_NOTIFICATIONS)
        !=PackageManager.PERMISSION_GRANTED)return;
    Map<String,String> data=message.getData();
    boolean isOrder="bite_order".equals(data.get("event_type"));
    String id=data.get("order_id"),restaurant=data.get("restaurant_id");
    // Never show order-action buttons for test pushes or arbitrary payloads.
    if(isOrder&&(id==null||restaurant==null||
       !id.matches("(?i)^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$")||
       !restaurant.matches("(?i)^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$")))return;

    NotificationManager manager=(NotificationManager)getSystemService(Context.NOTIFICATION_SERVICE);
    if(manager==null)return;
    if(Build.VERSION.SDK_INT>=26&&manager.getNotificationChannel(CHANNEL)==null){
      NotificationChannel channel=new NotificationChannel(CHANNEL,"New restaurant orders",
        NotificationManager.IMPORTANCE_HIGH);
      channel.enableVibration(true);
      manager.createNotificationChannel(channel);
    }
    String title=data.get("title");
    if(title==null||title.isEmpty())
      title=message.getNotification()!=null?message.getNotification().getTitle():"New Bite order";
    String body=data.get("body");
    if(body==null||body.isEmpty())
      body=message.getNotification()!=null?message.getNotification().getBody():"Open Bite Partner.";
    if(title==null)title="Bite notification";
    if(body==null)body="Open Bite Partner.";

    if(id==null||id.isEmpty())id=message.getMessageId();
    if(id==null||id.isEmpty())id="bite-general";
    NotificationCompat.Builder builder=new NotificationCompat.Builder(this,CHANNEL)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle(title)
      .setContentText(body)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(activityIntent(id,restaurant,null))
      .setAutoCancel(true);
    if(isOrder){
      NotificationCompat.Action accept=new NotificationCompat.Action.Builder(
         0,"Accept",activityIntent(id,restaurant,"Accepted"))
        .setAuthenticationRequired(true).build();
      NotificationCompat.Action reject=new NotificationCompat.Action.Builder(
         0,"Reject",activityIntent(id,restaurant,"Rejected"))
        .setAuthenticationRequired(true).build();
      builder.addAction(accept).addAction(reject);
    }
    manager.notify(id.hashCode() & 0x7fffffff,builder.build());
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
