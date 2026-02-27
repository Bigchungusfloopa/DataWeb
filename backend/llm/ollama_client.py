"""
Ollama HTTP client for Llama 3.1 8B.
"""
import httpx
import re

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "llama3.1:8b"
TIMEOUT = httpx.Timeout(120.0)


async def _call_ollama(prompt: str, temperature: float = 0.0, max_tokens: int = 512) -> str:
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        },
    }
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.post(OLLAMA_URL, json=payload)
        response.raise_for_status()
        return response.json().get("response", "").strip()


async def classify_question(prompt: str) -> str:
    """
    Returns one of: 'SQL', 'COMPUTE', 'GENERAL'
    Uses very low token count since we only need one word back.
    """
    raw = await _call_ollama(prompt, temperature=0.0, max_tokens=5)
    # Extract the classification word robustly
    upper = raw.strip().upper()
    for label in ("COMPUTE", "GENERAL", "SQL"):
        if label in upper:
            return label
    return "SQL"  # default to SQL if uncertain


async def generate_sql(prompt: str) -> str:
    raw = await _call_ollama(prompt, temperature=0.0)
    return _clean_sql(raw)


async def explain_results(prompt: str) -> str:
    return await _call_ollama(prompt, temperature=0.3)


async def answer_general(prompt: str) -> str:
    """Answer a question directly without SQL (definitions, conversions, advice)."""
    return await _call_ollama(prompt, temperature=0.1, max_tokens=400)


async def check_ollama_health() -> bool:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(3.0)) as client:
            r = await client.get("http://localhost:11434/api/tags")
            return r.status_code == 200
    except Exception:
        return False


def _clean_sql(raw: str) -> str:
    """Aggressively extract just the SQL from LLM output."""
    if not raw:
        return ""

    # Strip markdown code fences
    fence = re.search(r"```(?:sql)?\s*(.*?)```", raw, re.IGNORECASE | re.DOTALL)
    if fence:
        raw = fence.group(1).strip()

    raw = raw.replace("`", "").strip()

    # Find first SQL keyword
    match = re.search(r"\b(SELECT|WITH|INSERT|UPDATE|DELETE)\b", raw, re.IGNORECASE)
    if match:
        raw = raw[match.start():]

    # Take only first statement
    parts = [p.strip() for p in raw.split(";") if p.strip()]
    if parts:
        raw = parts[0]

    # Remove trailing prose lines
    sql_keywords = {
        "SELECT", "FROM", "WHERE", "GROUP", "ORDER", "HAVING", "LIMIT",
        "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "AND", "OR",
        "CASE", "WHEN", "THEN", "ELSE", "END", "AS", "BY", "WITH",
        "UNION", "CAST", "COUNT", "SUM", "AVG", "MIN", "MAX",
        "DISTINCT", "NOT", "NULL", "IS", "IN", "ROUND",
    }
    sql_lines = []
    for line in raw.splitlines():
        stripped = line.strip()
        first_word = stripped.split()[0].upper() if stripped.split() else ""
        if sql_lines and first_word not in sql_keywords and re.match(r'^[A-Z][a-z]', stripped):
            break
        sql_lines.append(line)

    return "\n".join(sql_lines).strip()
