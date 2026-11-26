#!/usr/bin/env python3
"""Install Customer-only Google OAuth bridge. The OAuth browser must never be a WebView."""
from pathlib import Path
import re

roots=list(Path("android/app/src/main/java").rglob("MainActivity.java"))
if len(roots)!=1:
    raise SystemExit("Expected precisely one Capacitor MainActivity")
activity=roots[0]
src=activity.read_text(encoding="utf-8")
match=re.search(r"(?m)^\s*package\s+([\w.]+);",src)
if not match:
    raise SystemExit("Android package missing")
package=match.group(1)
if package!="in.bite.restaurant":
    print("BiteGoogleOAuth: non-Customer app unchanged", package)
    raise SystemExit(0)
if "registerPlugin(BiteOrderAlertsPlugin.class);" not in src or "onCreate(" not in src:
    raise SystemExit("Native order bridge not patched; refusing unsafe OAuth modification")
if "BiteGoogleOAuthPlugin" in src:
    raise SystemExit("Unexpected pre-existing Google OAuth plugin; review manually")
src=src.replace(
    "registerPlugin(BiteOrderAlertsPlugin.class);",
    "registerPlugin(BiteOrderAlertsPlugin.class);\n    registerPlugin(BiteGoogleOAuthPlugin.class);",1
)
src=src.replace("super.onCreate(savedInstanceState);",
                "super.onCreate(savedInstanceState);\n    BiteGoogleOAuthPlugin.capture(getIntent());",1)
if "onNewIntent(" in src:
    raise SystemExit("Unexpected existing onNewIntent override")
new_intent=r'''
  @Override
  protected void onNewIntent(android.content.Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    BiteGoogleOAuthPlugin.capture(intent);
    if (getBridge()!=null && getBridge().getWebView()!=null) {
      // No code or token is passed by JS injection. JavaScript consumes via the native bridge.
      getBridge().getWebView().evaluateJavascript(
        "window.dispatchEvent(new Event('bite-google-oauth-return'))",null);
    }
  }
'''
src=src[:src.rfind("}")]+new_intent+src[src.rfind("}"):]
activity.write_text(src,encoding="utf-8")

manifest=Path("android/app/src/main/AndroidManifest.xml")
xml=manifest.read_text(encoding="utf-8")
m=re.search(r'<activity\b(?=[^>]*android:name="\.MainActivity")[^>]*>',xml,re.S)
if not m:
    raise SystemExit("MainActivity manifest entry missing; native callback not configured")
tag=m.group(0)
if "android:exported=" not in tag:
    raise SystemExit("MainActivity exported flag missing")
if 'android:launchMode="singleTask"' not in tag:
    if "android:launchMode=" in tag:
        raise SystemExit("Unexpected MainActivity launchMode")
    new_tag=tag.replace("<activity",'<activity android:launchMode="singleTask"',1)
    xml=xml[:m.start()]+new_tag+xml[m.end():]
    m=re.search(r'<activity\b(?=[^>]*android:name="\.MainActivity")[^>]*>',xml,re.S)
end=xml.find("</activity>",m.end())
if end<0:
    raise SystemExit("MainActivity end tag missing")
if 'android:scheme="bitecustomer"' in xml:
    raise SystemExit("Unexpected existing callback filter")
filter_xml='''
      <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="bitecustomer" android:host="oauth" android:path="/callback" />
      </intent-filter>
'''
xml=xml[:end]+filter_xml+xml[end:]
manifest.write_text(xml,encoding="utf-8")

gradle=Path("android/app/build.gradle")
build=gradle.read_text(encoding="utf-8")
if "androidx.browser:browser:" not in build:
    if "dependencies {" not in build:
        raise SystemExit("Expected Gradle dependencies declaration missing")
    build=build.replace("dependencies {","dependencies {\n    implementation 'androidx.browser:browser:1.8.0'",1)
    gradle.write_text(build,encoding="utf-8")

native=r'''package PACKAGE;

import android.content.Intent;
import android.net.Uri;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name="BiteGoogleOAuth")
public class BiteGoogleOAuthPlugin extends Plugin {
  private static String pendingRedirect;

  static synchronized void capture(Intent intent) {
    if(intent==null) return;
    Uri u=intent.getData();
    if(u==null || !"bitecustomer".equals(u.getScheme()) ||
       !"oauth".equals(u.getHost()) || !"/callback".equals(u.getPath()) ||
       u.getPort()!=-1 || u.getUserInfo()!=null) return;
    // Accept only a one-time PKCE authorization code or provider error, never OAuth tokens.
    String code=u.getQueryParameter("code"), error=u.getQueryParameter("error");
    if((code!=null && code.length()>0 && code.length()<=2048) ||
       (error!=null && error.length()>0 && error.length()<=120)) {
      pendingRedirect=u.toString();
    }
  }

  @PluginMethod
  public void consumeRedirect(PluginCall call) {
    JSObject out=new JSObject();
    synchronized(BiteGoogleOAuthPlugin.class) {
      if(pendingRedirect!=null) {
        out.put("url",pendingRedirect);
        pendingRedirect=null;
      }
    }
    call.resolve(out);
  }

  @PluginMethod
  public void open(PluginCall call) {
    String raw=call.getString("url","");
    Uri u;
    try {u=Uri.parse(raw);} catch(Exception e){call.reject("Invalid authorization URL");return;}
    String challenge=u.getQueryParameter("code_challenge");
    if(!"https".equals(u.getScheme()) ||
       !"wedbgpybbgsszcmffoha.supabase.co".equals(u.getHost()) ||
       !"/auth/v1/authorize".equals(u.getPath()) ||
       !"google".equals(u.getQueryParameter("provider")) ||
       !"bitecustomer://oauth/callback".equals(u.getQueryParameter("redirect_to")) ||
       challenge==null || !challenge.matches("[A-Za-z0-9_-]{43,128}")) {
      call.reject("Only the verified PKCE Google OAuth endpoint is permitted");
      return;
    }
    getActivity().runOnUiThread(()->{
      try {
        new CustomTabsIntent.Builder().build().launchUrl(getActivity(),u);
        call.resolve();
      } catch(Exception e) {
        call.reject("A supported Android browser is required for Google Login");
      }
    });
  }
}
'''
(activity.parent/"BiteGoogleOAuthPlugin.java").write_text(
    native.replace("PACKAGE",package,1),encoding="utf-8")
print("Customer Android: external Google OAuth Custom Tab + PKCE code callback installed")
