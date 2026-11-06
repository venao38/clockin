"""Start Clock-in'.   CLOCKIN_DATA_DIR=./data CLOCKIN_PORT=5002 python3 run.py"""
from clockin import ANY_HOST, create_app, settings, start_background_jobs

app = create_app()

if __name__ == "__main__":
    start_background_jobs()
    s = settings.SETTINGS
    print(f"Clock-in' · data in {s['data_dir']} · http://{s['host']}:{s['port']}", flush=True)
    if s["host"] in ANY_HOST:
        names = [h for h in app.config["TRUSTED_HOSTS"] if h not in ("localhost", "127.0.0.1", "[::1]")]
        print(f"  open it from other machines at: {', '.join(names)}"
              " (add other names to CLOCKIN_TRUSTED_HOSTS)", flush=True)
    app.run(host=s["host"], port=s["port"])
