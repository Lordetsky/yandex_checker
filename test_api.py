import httpx, asyncio

async def test():
    headers = {"Authorization": "OAuth y0__xCMs7DNBRiroEAg0aH1hhfgLYNTtKQRLbl3RY-UdqOPY-YQJQ"}
    BASE = "https://api.contest.yandex.net/api/public/v2"
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{BASE}/contests/91235/submissions", headers=headers, params={"page":1,"pageSize":2})
        print("List status:", r.status_code)
        subs = r.json().get("submissions", [])
        if not subs:
            print("No submissions"); return
        sub_id = subs[0]["id"]
        print("Sub ID:", sub_id)
        r2 = await c.get(f"{BASE}/contests/91235/submissions/{sub_id}/full", headers=headers)
        print("Full status:", r2.status_code)
        d = r2.json()
        print("Full keys:", list(d.keys()))
        has_source = bool(d.get("source", ""))
        has_tests = len(d.get("checkerLog", []))
        print("Has source:", has_source)
        print("Tests count:", has_tests)

asyncio.run(test())
