#!/usr/bin/env python3
"""Install a Customer-only Credential Manager bridge in the generated Capacitor app.
No Google secrets, passwords, or tokens are stored by this patch.
"""
import os
import re
from pathlib import Path

activity_files = list(Path("android/app/src/main/java").rglob("MainActivity.java"))
if len(activity_files) != 1:
    raise SystemExit("Expected exactly one MainActivity")
activity = activity_files[0]
source = activity.read_text()
if not re.search(r"(?m)^\s*package\s+in\.bite\.restaurant\s*;", source):
    raise SystemExit("Google bridge is Customer-only")
marker = "registerPlugin(BiteOrderAlertsPlugin.class);"
if source.count(marker) != 1:
    raise SystemExit("Native scaffold registration missing")
client_id = os.environ.get("BITE_GOOGLE_WEB_CLIENT_ID", "").strip()
if client_id and not re.fullmatch(r"[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com", client_id):
    raise SystemExit("Invalid Google Web OAuth client ID")
app = Path("android/app")
gradle_path = app / "build.gradle"
gradle = gradle_path.read_text()
if "dependencies {" not in gradle:
    raise SystemExit("Unexpected Android Gradle structure")
gradle = gradle.replace("dependencies {", """dependencies {
    implementation 'androidx.credentials:credentials:1.5.0'
    implementation 'androidx.credentials:credentials-play-services-auth:1.5.0'
    implementation 'com.google.android.libraries.identity.googleid:googleid:1.1.1'""", 1)
gradle_path.write_text(gradle)
activity.write_text(source.replace(marker, marker + "\n    registerPlugin(BiteCustomerGooglePlugin.class);", 1))
java = r'''package in.bite.restaurant;

import android.net.Uri;
import android.os.CancellationSignal;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.core.content.ContextCompat;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name="BiteCustomerGoogle")
public class BiteCustomerGooglePlugin extends Plugin {
  private static final String CLIENT_ID = "__CLIENT_ID__";
  private final AtomicBoolean busy = new AtomicBoolean(false);

  private boolean trustedPage() {
    String url = getBridge().getWebView().getUrl();
    if (url == null) return false;
    Uri uri = Uri.parse(url);
    return "https".equals(uri.getScheme())
      && "gauravjoshi2999.github.io".equals(uri.getHost())
      && (uri.getPort() == -1 || uri.getPort() == 443)
      && uri.getUserInfo() == null
      && "/restaurant-os/customer.html".equals(uri.getPath());
  }

  @PluginMethod
  public void availability(PluginCall call) {
    getActivity().runOnUiThread(() -> {
      JSObject out = new JSObject();
      out.put("ready", trustedPage() && !CLIENT_ID.isEmpty());
      call.resolve(out);
    });
  }

  private static String hex(byte[] bytes) {
    char[] alphabet = "0123456789abcdef".toCharArray();
    char[] out = new char[bytes.length * 2];
    for (int i=0; i<bytes.length; i++) {
      int n=bytes[i]&255;
      out[i*2]=alphabet[n>>>4]; out[i*2+1]=alphabet[n&15];
    }
    return new String(out);
  }

  @PluginMethod
  public void signIn(PluginCall call) {
    getActivity().runOnUiThread(() -> {
      if (!trustedPage() || CLIENT_ID.isEmpty()) {
        call.reject("Google sign-in is not configured", "NOT_CONFIGURED");
        return;
      }
      if (!busy.compareAndSet(false,true)) {
        call.reject("Google sign-in already open", "BUSY");
        return;
      }
      try {
        byte[] entropy = new byte[32];
        new SecureRandom().nextBytes(entropy);
        String nonce = hex(entropy);
        String hashed = hex(MessageDigest.getInstance("SHA-256").digest(nonce.getBytes(StandardCharsets.UTF_8)));
        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(CLIENT_ID)
          .setNonce(hashed).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder()
          .addCredentialOption(option).build();
        CredentialManager.create(getActivity()).getCredentialAsync(
          getActivity(), request, new CancellationSignal(),
          ContextCompat.getMainExecutor(getActivity()),
          new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
            @Override
            public void onResult(GetCredentialResponse response) {
              try {
                if (!trustedPage()) {
                  call.reject("Customer page changed", "CONTEXT_CHANGED");
                  return;
                }
                Credential credential = response.getCredential();
                if (!(credential instanceof CustomCredential)
                    || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                  call.reject("Unexpected credential type", "INVALID_CREDENTIAL");
                  return;
                }
                String token = GoogleIdTokenCredential.createFrom(credential.getData()).getIdToken();
                if (token == null || token.isEmpty()) {
                  call.reject("Google token unavailable", "INVALID_CREDENTIAL");
                  return;
                }
                JSObject result = new JSObject();
                result.put("idToken", token);
                result.put("nonce", nonce);
                call.resolve(result);
              } catch (Exception e) {
                call.reject("Google credential unavailable", "CREDENTIAL_ERROR");
              } finally { busy.set(false); }
            }
            @Override
            public void onError(GetCredentialException e) {
              busy.set(false);
              if (e instanceof GetCredentialCancellationException) {
                call.reject("Google sign-in cancelled", "CANCELLED");
              } else {
                call.reject("Google account sign-in unavailable", "CREDENTIAL_ERROR");
              }
            }
          });
      } catch (Exception e) {
        busy.set(false);
        call.reject("Could not start Google sign-in", "CREDENTIAL_ERROR");
      }
    });
  }
}
'''
(activity.parent / "BiteCustomerGooglePlugin.java").write_text(java.replace("__CLIENT_ID__", client_id))
print("Customer Credential Manager bridge installed; configured:", bool(client_id))
