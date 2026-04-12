import os
import sys
import subprocess
import venv
from pathlib import Path

def setup_venv():
    venv_dir = Path(".venv")
    if not venv_dir.exists():
        print("Creating virtual environment...")
        venv.create(venv_dir, with_pip=True)
    
    # Determine the python and pip paths
    if sys.platform == "win32":
        python_exe = venv_dir / "Scripts" / "python.exe"
        pip_exe = venv_dir / "Scripts" / "pip.exe"
    else:
        python_exe = venv_dir / "bin" / "python"
        pip_exe = venv_dir / "bin" / "pip"
    
    return str(python_exe), str(pip_exe)

def install_deps(python_exe):
    print("Installing dependencies...")
    subprocess.check_call([python_exe, "-m", "pip", "install", "--upgrade", "pip"])
    subprocess.check_call([python_exe, "-m", "pip", "install", "-r", "requirements.txt"])

def get_oauth_token():
    env_path = Path(".env")
    token = None
    
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("YANDEX_TOKEN="):
                    token = line.split("=", 1)[1].strip()
                    break
    
    if token:
        return token

    print("\n" + "="*50)
    print("Yandex Contest Token Setup")
    print("="*50)
    print("1. Create an APP here: https://oauth.yandex.ru/")
    print("   - Platform: Web services")
    print("   - Permissions: contest:read, contest:public_api")
    print("   - Callback URL: https://oauth.yandex.ru/verification_code")
    print("="*50 + "\n")

    client_id = input("Enter CLIENT_ID: ").strip()
    client_secret = input("Enter CLIENT_SECRET: ").strip()

    print("\n" + "="*50)
    print("2. Now get your Authorization Code by visiting this link:")
    print(f"   https://oauth.yandex.ru/authorize?response_type=code&client_id={client_id}")
    print("="*50 + "\n")

    code = input("Enter AUTHORIZATION_CODE: ").strip()

    import requests # Available after install_deps
    url = "https://oauth.yandex.ru/token"
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret
    }

    print("Exchanging code for token...")
    response = requests.post(url, data=data)
    if response.status_code == 200:
        token_data = response.json()
        access_token = token_data.get("access_token")
        
        # Save to .env
        with open(env_path, "a", encoding="utf-8") as f:
            f.write(f"\nYANDEX_TOKEN={access_token}\n")
        
        print("Success! Token saved to .env")
        return access_token
    else:
        print(f"Error fetching token: {response.status_code}")
        print(response.text)
        sys.exit(1)

def main():
    python_exe, pip_exe = setup_venv()
    install_deps(python_exe)
    
    # We need requests to get the token, and it's installed now
    token = get_oauth_token()
    
    print("\n" + "="*50)
    print("🚀 Starting CU Contest Checker")
    print(f"🔗 URL: http://localhost:8000")
    print("="*50 + "\n")
    
    # Run uvicorn
    # python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
    try:
        subprocess.run([
            python_exe, "-m", "uvicorn", "main:app",
            "--host", "0.0.0.0",
            "--port", "8000",
            "--reload"
        ])
    except KeyboardInterrupt:
        print("\nStopping...")

if __name__ == "__main__":
    main()
