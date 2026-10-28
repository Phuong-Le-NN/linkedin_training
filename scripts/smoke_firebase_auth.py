"""Create and sign in a real Firebase email/password test account."""

from getpass import getpass

import requests


API_KEY = "AIzaSyD3_BUdDFxnK4knreXfTQUrpUzsaNTJ7dk"
AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts"


def call_firebase(action: str, email: str, password: str) -> dict:
    response = requests.post(
        f"{AUTH_URL}:{action}",
        params={"key": API_KEY},
        json={"email": email, "password": password, "returnSecureToken": True},
        timeout=15,
    )
    if not response.ok:
        error = response.json().get("error", {}).get("message", "Unknown error")
        raise SystemExit(f"Firebase {action} failed ({response.status_code}): {error}")
    return response.json()


def main() -> None:
    email = input("New test account email: ").strip()
    password = getpass("New test account password: ")
    if not email or not password:
        raise SystemExit("Email and password are required.")

    created = call_firebase("signUp", email, password)
    print(f"Created Firebase user {created['localId']}.")

    signed_in = call_firebase("signInWithPassword", email, password)
    if signed_in["localId"] != created["localId"] or not signed_in.get("idToken"):
        raise SystemExit("Sign-in did not return the new user's ID token.")
    print("Live Firebase sign-up and sign-in passed. The account was kept.")


if __name__ == "__main__":
    main()
