from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from fastapi.responses import HTMLResponse
import httpx
import asyncio
import difflib
import os
import json
from dotenv import load_dotenv
from typing import Optional, List
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from pathlib import Path
from functools import lru_cache
import openpyxl

load_dotenv()

app = FastAPI(title="CU Contest Checker")

Path("static").mkdir(exist_ok=True)
Path("templates").mkdir(exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

BASE_URL = "https://api.contest.yandex.net/api/public/v2"
OAUTH_TOKEN = os.getenv("YANDEX_TOKEN")

MOSCOW_TZ = timezone(timedelta(hours=3))

# --- Contest Registry ---
REGISTRY_FILE = Path("contests_registry.json")
CONTESTS_REGISTRY: list = []  # [{"id": int, "name": str, "startTime": str|None, "lastUsed": str}]

def load_registry():
    global CONTESTS_REGISTRY
    if REGISTRY_FILE.exists():
        try:
            with open(REGISTRY_FILE, "r", encoding="utf-8") as f:
                CONTESTS_REGISTRY = json.load(f)
        except Exception as e:
            print(f"Warning: Could not load contests registry: {e}")
            CONTESTS_REGISTRY = []

def save_registry():
    try:
        with open(REGISTRY_FILE, "w", encoding="utf-8") as f:
            json.dump(CONTESTS_REGISTRY, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Warning: Could not save contests registry: {e}")

def upsert_contest(contest_id: int, name: str, start_time: str = None):
    """Add or update a contest in the registry."""
    now = datetime.now(MOSCOW_TZ).isoformat()
    for entry in CONTESTS_REGISTRY:
        if entry["id"] == contest_id:
            entry["name"] = name
            entry["lastUsed"] = now
            if start_time:
                entry["startTime"] = start_time
            save_registry()
            return entry
    new_entry = {"id": contest_id, "name": name, "startTime": start_time, "lastUsed": now}
    CONTESTS_REGISTRY.append(new_entry)
    CONTESTS_REGISTRY.sort(key=lambda x: x["id"])
    save_registry()
    return new_entry

load_registry()

# --- Simple In-Memory Cache ---
CACHE = {}  # { (contest_id, key): (expire_at, data) }
CACHE_TTL = 300  # 5 minutes

def get_cached_data(contest_id: int, key: str):
    entry = CACHE.get((contest_id, key))
    if entry:
        expire_at, data = entry
        if datetime.now() < expire_at:
            return data
    return None

def set_cached_data(contest_id: int, key: str, data):
    expire_at = datetime.now() + timedelta(seconds=CACHE_TTL)
    CACHE[(contest_id, key)] = (expire_at, data)

# --- Students Database ---
STUDENTS_DB = []
try:
    if os.path.exists('Students.xlsx'):
        wb = openpyxl.load_workbook('Students.xlsx', data_only=True)
        ws = wb.active
        for idx, row in enumerate(ws.values):
            if idx == 0: continue
            email, full_name = row[0], row[1]
            if email and full_name:
                STUDENTS_DB.append({'email': str(email).lower().strip(), 'full_name': str(full_name).lower().strip()})
except Exception as e:
    print("Warning: Could not load Students.xlsx:", e)

# --- Search Utils ---
CYR_TO_LAT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'j', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
}

def transliterate(text: str) -> str:
    res = []
    for char in text.lower():
        res.append(CYR_TO_LAT.get(char, char))
    return "".join(res)

def get_author_name(author: str) -> str:
    author_lower = author.lower().strip()
    for student in STUDENTS_DB:
        email = student['email']
        email_prefix = email.split('@')[0]
        if author_lower in (email, email_prefix, student['full_name']):
            return student['full_name'].title()
    return author

def check_author_match_fuzzy(query: str, author: str, threshold: float = 0.7) -> bool:
    if not query:
        return True
    
    query_lower = query.lower().strip()
    author_lower = author.lower().strip()
    
    q_parts = query_lower.split()
    if not q_parts:
        return True
        
    a = author_lower
    a_lat = transliterate(a) # Convert author name to latin too (in case it's in Cyrillic)
    
    # Check if ALL words from query are present in author string (directly or transliterated)
    for part in q_parts:
        part_lat = transliterate(part)
        
        # Match against raw author name or its transliterated version
        if part_lat in a or part_lat in a_lat:
            continue
            
        # Match raw query part (if user typed cyrillic and system has cyrillic)
        if part in a:
            continue
            
        # Fuzzy (only if part is long enough)
        if len(part_lat) > 3:
            # We check fuzzy against parts of the author name (raw and latin)
            a_parts = (a + " " + a_lat).replace('_', ' ').replace('.', ' ').split()
            best_ratio = 0
            for ap in a_parts:
                if not ap: continue
                ratio = difflib.SequenceMatcher(None, part_lat, ap).ratio()
                best_ratio = max(best_ratio, ratio)
            
            if best_ratio >= threshold:
                continue
        
        return False
        
    return True


def get_headers():
    return {
        "Authorization": f"OAuth {OAUTH_TOKEN}",
        "Content-Type": "application/json",
    }

def parse_submission_time(time_str: str) -> datetime:
    """Parse submission time from ISO format, always returns Moscow time."""
    if not time_str:
        return None
    if time_str.endswith("Z"):
        dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
    else:
        dt = datetime.fromisoformat(time_str)
    return dt.astimezone(MOSCOW_TZ)


def format_deadline_diff(sub_time_msk: datetime, deadline: datetime) -> dict:
    diff = sub_time_msk - deadline
    total_seconds = int(diff.total_seconds())
    is_late = total_seconds > 0
    abs_seconds = abs(total_seconds)
    hours = abs_seconds // 3600
    minutes = (abs_seconds % 3600) // 60
    label = f"{hours}ч {minutes}мин" if hours > 0 else f"{minutes}мин"
    return {"is_late": is_late, "label": label, "total_seconds": total_seconds}


async def fetch_contest_problems_map(client: httpx.AsyncClient, contest_id: int) -> dict:
    """Fetch map of problem alias -> name."""
    try:
        resp = await client.get(
            f"{BASE_URL}/contests/{contest_id}/problems",
            headers=get_headers(),
            timeout=15.0,
        )
        if resp.status_code == 200:
            return {p["alias"]: p["name"] for p in resp.json().get("problems", [])}
    except Exception:
        pass
    return {}


async def fetch_full_report(
    client: httpx.AsyncClient,
    contest_id: int,
    sub_id: int,
    semaphore: asyncio.Semaphore,
) -> dict:
    """Fetch full report (source + tests) for one submission."""
    async with semaphore:
        try:
            resp = await client.get(
                f"{BASE_URL}/contests/{contest_id}/submissions/{sub_id}/full",
                headers=get_headers(),
                timeout=30.0,
            )
            if resp.status_code == 200:
                return resp.json()
        except Exception:
            pass
    return {}


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"request": request}
    )


@app.get("/api/authors")
async def get_authors(contest_id: int):
    """Fetch unique authors for a contest (with caching)."""
    cached = get_cached_data(contest_id, "authors")
    if cached:
        return {"authors": cached}

    async with httpx.AsyncClient(timeout=30.0) as client:
        authors = set()
        current_page = 1
        while True:
            resp = await client.get(
                f"{BASE_URL}/contests/{contest_id}/submissions",
                headers=get_headers(),
                params={"page": current_page, "pageSize": 100},
            )
            if resp.status_code != 200:
                break
            data = resp.json()
            subs = data.get("submissions", [])
            if not subs:
                break
            for s in subs:
                author = s.get("author")
                if author:
                    authors.add(author)
            if len(authors) >= data.get("count", 0) or len(subs) < 100:
                break
            current_page += 1
        
        result = sorted(list(authors))
        set_cached_data(contest_id, "authors", result)
        return {"authors": result}


@app.get("/api/submissions/{contest_id}/{sub_id}/full")
async def get_full_submission(contest_id: int, sub_id: int):
    """Fetch full report for one submission."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{BASE_URL}/contests/{contest_id}/submissions/{sub_id}/full",
            headers=get_headers(),
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()


@app.get("/api/submissions/{contest_id}/diff")
async def get_submission_diff(contest_id: int, sub1: int, sub2: int):
    """Fetch diff between two submissions (sub1 is older, sub2 is newer)."""
    async def fetch_code(client: httpx.AsyncClient, sub_id: int) -> str:
        resp = await client.get(
            f"{BASE_URL}/contests/{contest_id}/submissions/{sub_id}/full",
            headers=get_headers(),
        )
        if resp.status_code == 200:
            return resp.json().get("source", "")
        return ""

    async with httpx.AsyncClient(timeout=30.0) as client:
        source1, source2 = await asyncio.gather(
            fetch_code(client, sub1),
            fetch_code(client, sub2)
        )
        
    diff_lines = list(difflib.unified_diff(
        source1.splitlines(),
        source2.splitlines(),
        fromfile=f"Submission #{sub1}",
        tofile=f"Submission #{sub2}",
        lineterm=""
    ))
    
    return {"diff": "\n".join(diff_lines)}


@app.get("/api/submissions")
async def get_submissions(
    contest_id: int,
    deadline: str,
    author: Optional[str] = None,
    exact_match: bool = False,
):
    """
    Fetch submissions for a contest. Uses lazy loading for code/logs.
    """
    try:
        deadline_msk = datetime.fromisoformat(deadline).replace(tzinfo=MOSCOW_TZ)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid deadline format. Use YYYY-MM-DDTHH:MM")

    # Try cache first
    cached_subs = get_cached_data(contest_id, "submissions")
    cached_problems = get_cached_data(contest_id, "problems")

    if cached_subs and cached_problems:
        all_submissions = cached_subs
        problems_map = cached_problems
    else:
        all_submissions = []
        async with httpx.AsyncClient(timeout=60.0) as client:
            # Step 1: fetch all submissions (metadata only)
            current_page = 1
            while True:
                resp = await client.get(
                    f"{BASE_URL}/contests/{contest_id}/submissions",
                    headers=get_headers(),
                    params={"page": current_page, "pageSize": 100},
                )
                if resp.status_code != 200:
                    raise HTTPException(status_code=resp.status_code, detail=f"Yandex API error: {resp.text}")
                data = resp.json()
                subs = data.get("submissions", [])
                if not subs: break
                all_submissions.extend(subs)
                if len(all_submissions) >= data.get("count", 0) or len(subs) < 100: break
                current_page += 1
            
            # Step 2: fetch problems map
            problems_map = await fetch_contest_problems_map(client, contest_id)
            
            set_cached_data(contest_id, "submissions", all_submissions)
            set_cached_data(contest_id, "problems", problems_map)

    # Filtering logic (improved with 3-tier cascade and disambiguation)
    if author:
        if exact_match:
            filtered = [s for s in all_submissions if s.get("author", "") == author]
        else:
            unique_authors = {s.get("author", "") for s in all_submissions if s.get("author")}
            
            query_lower = author.lower().strip()
            
            # Tier 1: Direct substring in Yandex login
            t1 = {a for a in unique_authors if query_lower in a.lower()}
            
            # Tier 2: DB Lookup
            t2 = set()
            if not t1:
                for a in unique_authors:
                    a_lower = a.lower()
                    for student in STUDENTS_DB:
                        if query_lower in student['full_name']:
                            email = student['email']
                            email_prefix = email.split('@')[0]
                            if a_lower in (email, email_prefix, student['full_name']):
                                t2.add(a)
            
            # Tier 3: Fuzzy matching
            t3 = set()
            if not t1 and not t2:
                for a in unique_authors:
                    if check_author_match_fuzzy(query_lower, a):
                        t3.add(a)
                        
            active_matches = t1 or t2 or t3
            
            if len(active_matches) > 1:
                matches_info = [{"author": am, "name": get_author_name(am)} for am in sorted(list(active_matches))]
                return {"status": "multiple", "matches": matches_info}
                
            filtered = [s for s in all_submissions if s.get("author", "") in active_matches]
    else:
        filtered = all_submissions

    # Enriching metadata (problem name and deadline)
    enriched = []
    for sub in filtered:
        time_str = sub.get("submissionTime", "")
        sub_time_msk = parse_submission_time(time_str)
        deadline_diff = format_deadline_diff(sub_time_msk, deadline_msk) if sub_time_msk else None
        
        # We don't have checkerLog here (lazy loading), but we have verdict/score
        enriched.append({
            "id": sub.get("id"),
            "problem_alias": sub.get("problemAlias", ""),
            "problem_name": problems_map.get(sub.get("problemAlias", ""), ""),
            "author": sub.get("author", ""),
            "compiler": sub.get("compiler", ""),
            "submission_time_msk": sub_time_msk.strftime("%d.%m.%Y %H:%M:%S") if sub_time_msk else "",
            "timestamp": sub_time_msk.timestamp() if sub_time_msk else 0,
            "verdict": sub.get("verdict", ""),
            "score": sub.get("score"),
            "deadline_diff": deadline_diff,
            "has_full_report": False, # Signal to frontend to fetch it later
        })

    # Sort by is_late (on-time first = 0, late = 1), then by newest (timestamp descending)
    enriched.sort(key=lambda x: (
        1 if (x.get("deadline_diff") and x["deadline_diff"].get("is_late")) else 0,
        -x["timestamp"]
    ))
    
    unique_authors = {s["author"] for s in enriched}
    is_single_student = len(unique_authors) == 1
    
    stats = compute_stats(
        enriched, 
        deadline_msk, 
        is_person=is_single_student, # Only show grade if single student
        total_tasks=len(problems_map)
    )

    return {"submissions": enriched, "stats": stats, "total": len(enriched)}


def compute_stats(submissions: list, deadline_msk: datetime, is_person: bool = False, total_tasks: int = 0) -> dict:
    verdict_counts: dict = defaultdict(int)
    scores = []
    time_distribution: dict = defaultdict(int)
    before_deadline = 0
    after_deadline = 0
    solved_set = set()

    for sub in submissions:
        verdict = sub.get("verdict", "Unknown")
        verdict_counts[verdict] += 1
        
        if is_person and verdict in ("OK", "Accepted"):
            alias = sub.get("problem_alias")
            diff = sub.get("deadline_diff")
            # Only count as solved if submitted BEFORE the deadline
            is_on_time = diff and not diff["is_late"]
            if alias and is_on_time:
                solved_set.add(alias)

        sc = sub.get("score")
        if sc is not None:
            try:
                scores.append(float(sc))
            except (TypeError, ValueError):
                pass

        diff = sub.get("deadline_diff")
        if diff:
            if diff["is_late"]:
                after_deadline += 1
            else:
                before_deadline += 1

        time_str = sub.get("submission_time_msk", "")
        if time_str:
            try:
                dt = datetime.strptime(time_str, "%d.%m.%Y %H:%M:%S")
                if is_person:
                    minute = (dt.minute // 15) * 15
                    dt = dt.replace(minute=minute, second=0)
                    bucket = dt.strftime("%d.%m %H:%M")
                else:
                    bucket = dt.strftime("%d.%m %H:00")
                time_distribution[bucket] += 1
            except ValueError:
                pass

    avg_score = round(sum(scores) / len(scores), 2) if scores else None
    sorted_time = dict(sorted(time_distribution.items()))

    result = {
        "total": len(submissions),
        "avg_score": avg_score,
        "verdict_counts": dict(verdict_counts),
        "time_distribution": sorted_time,
        "before_deadline": before_deadline,
        "after_deadline": after_deadline,
    }

    if is_person and total_tasks > 0:
        solved_count = len(solved_set)
        result["solved_tasks"] = solved_count
        result["total_tasks"] = total_tasks
        result["grade"] = round((solved_count / total_tasks) * 10, 2)

    return result


@app.get("/api/contest-info")
async def get_contest_info(contest_id: int):
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{BASE_URL}/contests/{contest_id}",
            headers=get_headers(),
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()
