#!/usr/bin/env python3
"""One-time owner-controlled setup. Requires JDK keytool and authenticated gh CLI.
Run from a trusted machine; secrets are sent only to the selected GitHub environment.
No keystore, password, token, or private key is written to the repository or logs.
"""
import base64
import getpass
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

REPO = "mjmadani07-dotcom/ExpenseScan-AI"
ENVIRONMENT = "android-signing"
ALIAS = "hesabyar"
KEY = Path.home() / ".hesabyar-signing" / "hesabyar.p12"
CERT = KEY.with_suffix(".sha256")
API = f"repos/{REPO}/environments/{ENVIRONMENT}"
NAMES = ("ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_PASSWORD", "ANDROID_KEY_ALIAS")

def run(args, *, data=None, env=None, capture=False):
    result = subprocess.run(args, input=data, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise RuntimeError(f"{Path(args[0]).name} {args[1]} failed (exit {result.returncode}); check permissions or credentials locally.")
    return result.stdout if capture else None

def api(path):
    return json.loads(run(["gh", "api", path], capture=True))

def main():
    if not sys.stdin.isatty():
        raise RuntimeError("Run interactively in a trusted terminal, not CI or a notebook.")
    for name in ("keytool", "gh"):
        if not shutil.which(name):
            raise RuntimeError(f"Install {name} and make it available on PATH.")
    run(["gh", "auth", "status"])
    api(API)  # must already exist, with owner-chosen deployment restrictions
    variables = {x["name"]: x["value"] for x in api(API + "/variables?per_page=100")["variables"]}
    existing = {x["name"] for x in api(API + "/secrets?per_page=100")["secrets"]}
    expected = variables.get("ANDROID_CERT_SHA256", "").replace(":", "").strip().lower()
    if existing.intersection(NAMES) and not expected:
        raise RuntimeError("Existing signing secrets without a certificate pin. Stop; inspect the environment. Do not overwrite.")
    if expected and not KEY.is_file():
        raise RuntimeError(f"A signing certificate is already pinned. Restore the original keystore to {KEY}; never generate a replacement.")
    print(f"Repository: {REPO}\nEnvironment: {ENVIRONMENT}\nLocal keystore: {KEY}")
    print("Keep two protected offline copies of the keystore and remember its password.")
    print("This script uploads encrypted GitHub environment secrets only after your approval.")
    if input("Type YES to proceed: ").strip() != "YES":
        return
    password = getpass.getpass("Keystore password (at least 16 characters): ")
    if len(password) < 16 or "\n" in password or "\r" in password:
        raise RuntimeError("Use a password of at least 16 characters without line breaks.")
    if not KEY.exists() and password != getpass.getpass("Repeat password: "):
        raise RuntimeError("Passwords do not match.")
    key_env = dict(os.environ, HESABYAR_KS_PASS=password)
    KEY.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not KEY.exists():
        run(["keytool", "-genkeypair", "-keystore", str(KEY), "-storetype", "PKCS12",
             "-alias", ALIAS, "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
             "-dname", "CN=HesabYar Android Signing",
             "-storepass:env", "HESABYAR_KS_PASS", "-keypass:env", "HESABYAR_KS_PASS"], env=key_env)
    if os.name != "nt":
        KEY.chmod(0o600)
    der = run(["keytool", "-exportcert", "-alias", ALIAS, "-keystore", str(KEY),
               "-storetype", "PKCS12", "-storepass:env", "HESABYAR_KS_PASS"], env=key_env, capture=True)
    fingerprint = hashlib.sha256(der).hexdigest()
    if expected and expected != fingerprint:
        raise RuntimeError("Certificate mismatch: refusing to replace an existing signing identity.")
    CERT.write_text(fingerprint + "\n", encoding="ascii")
    print("Public certificate SHA-256:", fingerprint)
    if input("Back up the key first. Type UPLOAD to configure GitHub: ").strip() != "UPLOAD":
        print("Local keystore retained; rerun to continue with the same key.")
        return
    # Pin first, so an interrupted upload cannot allow a different key later.
    run(["gh", "variable", "set", "ANDROID_CERT_SHA256", "--repo", REPO,
         "--env", ENVIRONMENT, "--body", fingerprint])
    values = (base64.b64encode(KEY.read_bytes()), password.encode(), password.encode(), ALIAS.encode())
    for name, value in zip(NAMES, values):
        run(["gh", "secret", "set", name, "--repo", REPO, "--env", ENVIRONMENT], data=value)
        print("Configured:", name)
    print("Signing setup complete. Keep your key and password private. Do not delete the installed app without a verified external backup.")

if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        # Do not dump child output, environments, secret payloads, or tracebacks.
        print(f"Setup stopped: {exc}", file=sys.stderr)
        sys.exit(1)
