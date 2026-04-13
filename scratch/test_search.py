
CYR_TO_LAT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ы': 'y', 'ь': '', 'ъ': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
}

ALT_MAP = {
    'shch': 'sh', 'sch': 'sh', 'sz': 's', 'cz': 'c', 'tz': 'c', 'ts': 'c',
    'kh': 'h', 'zh': 'j', 'ch': 'c', 'ks': 'x', 'ph': 'f', 'th': 't',
    'w': 'v', 'yo': 'e', 'jo': 'e', 'ya': 'a', 'ia': 'a', 'ja': 'a',
    'yu': 'u', 'iu': 'u', 'ju': 'u', 'y': 'i', 'j': 'i'
}

def transliterate(text):
    res = []
    for char in text.lower():
        res.append(CYR_TO_LAT.get(char, char))
    return "".join(res)

def normalize_phonetic(text: str) -> str:
    t = transliterate(text.lower().strip())
    t = t.replace('_', '').replace('.', '').replace('-', '')
    for k in sorted(ALT_MAP.keys(), key=len, reverse=True):
        t = t.replace(k, ALT_MAP[k])
    if not t: return ""
    res = [t[0]]
    for i in range(1, len(t)):
        if t[i] != t[i-1]:
            res.append(t[i])
    return "".join(res)

def test(q, a):
    qn = normalize_phonetic(q)
    an = normalize_phonetic(a)
    match = qn in an
    print(f"Q: {q} -> {qn}")
    print(f"A: {a} -> {an}")
    print(f"Match: {match}")

test("Баранцев", "barantsev")
test("баранцов", "barantsev")
test("баранцов", "баранов")
test("баранцев", "баранов")
