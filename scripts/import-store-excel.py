"""Converts the stores' Excel files into rows for Supabase (one-off import).

  python3 scripts/import-store-excel.py <Análise de Vendas.xlsx> <Eficácia das campanhas - LOJAS.xlsx> <out dir>

Writes sales.json (one row per customer served, May–Oct 2026) and gold_monthly.json
(monthly gold purchase totals per store, 2022–2026). Free text typed by the stores
is mapped to the option codes in ldo_options; the original text is kept in notes
whenever the mapping loses information.
"""
import datetime
import json
import re
import sys
import unicodedata

import openpyxl

SALES_STORES = {
    "Entroncamento": "entroncamento", "Figueira da Foz": "figueira-da-foz", "Leiria Jericó": "leiria-jerico",
    "Leiria City": "leiria-city", "Santarém": "santarem", "Tomar": "tomar", "Cartaxo": "cartaxo",
    "Torres Novas": "torres-novas", "Abrantes": "abrantes", "Coimbra": "coimbra", "Loures": "loures",
    "Benfica": "benfica", "Fátima": "fatima",
}
GOLD_STORES = {
    "JERICO": "leiria-jerico", "LEIRIA CITY": "leiria-city", "FIG FOZ": "figueira-da-foz", "ABRANTES": "abrantes",
    "TOMAR": "tomar", "ENTRONCAMENTO": "entroncamento", "SANTAREM": "santarem", "CARTAXO": "cartaxo",
    "TORRES NOVAS": "torres-novas", "LOURES": "loures", "COIMBRA": "coimbra", "BENFICA": "benfica", "FATIMA": "fatima",
}
MONTHS = {m: i + 1 for i, m in enumerate(
    ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"])}
KARATS = [("9", 5, 6), ("14", 8, 9), ("18", 11, 12), ("19", 14, 15), ("22", 17, 18), ("24", 20, 21)]
YEAR = 2026
TODAY = datetime.date.today()


def plain(value):
    """Upper case, no accents, single spaces."""
    text = unicodedata.normalize("NFD", str(value)).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text).strip().upper()


def text(value):
    return None if value is None or str(value).strip() in ("", "-----", "------") else str(value).strip()


def number(value):
    if isinstance(value, (int, float)):
        return round(float(value), 2)
    t = text(value)
    if not t:
        return None
    t = t.replace("€", "").replace(" ", "").replace(",", ".")
    try:
        return round(float(t), 2)
    except ValueError:
        return None


def first(t, rules, default=None):
    for pattern, code in rules:
        if re.search(pattern, t):
            return code
    return default


def campaign(value):
    if isinstance(value, (int, float)):
        return True, "desconto"
    t = plain(value) if text(value) else ""
    if not t or re.fullmatch(r"N[AO]+[O ]*", t) or t.startswith("NAO") or t.startswith("NAÕ"):
        return (False, None) if t else (None, None)
    code = first(t, [(r"SALDO", "saldos"), (r"VERAO", "verao"), (r"\bFE\b", "fe"), (r"DESCONTO|%", "desconto"),
                     (r"STOCK|SOTCK", "stock_off")], "outra")
    return True, code


MATERIAL_RULES = [(r"RELOGIO", "relogio"), (r"OURO|\bAU\b", "ouro"), (r"PRATA|PARTA|PRTA|\bAG\b", "prata"),
                  (r"ACO", "aco"), (r"METAL", "metal_comum")]
TYPE_RULES = [(r"EARCUFF|BRINCO", "brincos"), (r"ARGOLA", "argolas"), (r"ALIANC", "aliancas"), (r"ESCRAVA", "escrava"),
              (r"PULS|BRACELETE", "pulseira"), (r"FIO|CORRENTE", "fio"), (r"COLAR", "colar"),
              (r"ANEL|ANEIS|SOLITARIO|\bARO\b", "anel"), (r"MEDALHA|MADALHA|\bMED\b", "medalha"),
              (r"CRUZ|CRUCIFIXO|CRUXIFIXO", "cruz"), (r"ESCAPULARIO", "escapulario"), (r"TERCO", "terco"),
              (r"ALFINETE", "alfinete"), (r"BARRA", "barra"), (r"MOEDA|LIBRA", "moeda"), (r"RELOGIO", "relogio"),
              (r"CONJUNTO", "conjunto")]


def split_parts(value):
    t = plain(value) if text(value) else ""
    return [p.strip() for p in re.split(r"/|\+|,| E | - ", t) if p.strip()] if t else []


def client_type(value):
    t = plain(value) if text(value) else ""
    return first(t, [(r"NOV", "novo"), (r"HAB|CLIENTE|COLEGA", "habitual"), (r"PASSAGEM", "passagem")]) if t else None


def seen_where(value):
    t = plain(value) if text(value) else ""
    return first(t, [(r"SITE|ONLINE|NET", "site"), (r"INSTAGRAM|FACEBOOK", "redes_sociais"),
                     (r"CHAT|WHATSAPP|TELEFONE", "telefone"), (r"RECOMEND", "recomendacao"), (r"MONTRA|MONRA", "montra"),
                     (r"LOJA|ARMAZEM", "loja")], "outro") if t else None


def yes_no(value):
    t = plain(value) if text(value) else ""
    if not t:
        return None
    return True if t.startswith("SIM") else False if t[:2] in ("NA", "MA") else None


def restock(value):
    if isinstance(value, datetime.datetime):
        return "pedido"
    t = plain(value) if text(value) else ""
    return first(t, [(r"SIMILAR|SEMELHANTE|TENHO MAIS|TENHO EM LOJA", "tenho_similar"),
                     (r"PEDIDO|MEDIANTE|SOLICITA", "a_pedido"), (r"^X|^SIM|JA PEDI|PEDI UMA", "pedido"),
                     (r"^NAO", "nao")]) if t else None


def purpose(value):
    t = plain(value) if text(value) else ""
    return first(t, [(r"OFERE|OFERTA|FAMILIA", "oferta"), (r"INVESTIMENTO", "investimento"),
                     (r"PROPRI|PESSOAL|PARA SI", "proprio")]) if t else None


def no_sale(value):
    t = plain(value) if text(value) else ""
    return first(t, [(r"TROCA", "troca"), (r"CARO|ABSURDO|SUPERIORES|PRECO ABAIXO", "caro"),
                     (r"TAMANHO|\bNR\b|NAO SERVIA", "sem_tamanho"),
                     (r"NAO TENHO|NAO TINHA|NAO HAVIA|SO EXISTE|QUERIA|MANDEI VIR|PERSONALIZADO", "sem_stock")],
                 "outro") if t else None


def parse_date(value, previous):
    """Dates typed as text or with a wrong year are read as 2026 (the file covers May–Oct 2026)."""
    note = None
    if isinstance(value, datetime.datetime):
        d = value.date()
    elif text(value) and re.match(r"^\d{1,2}/\d{1,2}", str(value).strip()):
        day, month = map(int, re.findall(r"\d+", str(value))[:2])
        d, note = datetime.date(YEAR, month, day), f"data escrita como texto ({value})"
    else:
        return previous, None
    if d.year != YEAR:
        note = f"ano corrigido de {d.year} para {YEAR}"
        d = d.replace(year=YEAR)
    # The file covers May to October: a month outside it is usually day and month swapped.
    if not 5 <= d.month <= 10 or d > TODAY:
        if 5 <= d.day <= 10 and datetime.date(YEAR, d.day, d.month) <= TODAY:
            note, d = f"dia e mês trocados ({d.isoformat()})", datetime.date(YEAR, d.day, d.month)
        elif previous:
            note, d = f"data inválida ({d.isoformat()}), usado o dia da linha anterior", previous
    return d, note


def sales_rows(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    out = []
    for ws in wb.worksheets:
        store = SALES_STORES[ws.title]
        current_date = None
        last = None
        for raw in ws.iter_rows(values_only=True):
            r = list(raw)[:15] + [None] * max(0, 15 - len(raw))
            a = r[0]
            if isinstance(a, str) and (plain(a) in MONTHS or a.strip() == "Data" or a.strip().startswith("Ex")):
                last = None
                continue
            if not any(text(c) for c in r[:15]):
                continue
            # A row with only a reference is one more article of the sale above.
            if r[0] is None and r[1] is None and text(r[2]) and not any(text(c) for c in r[3:14]) and last:
                last["items"].append({"reference": text(r[2]), "material": last["items"][0].get("material"),
                                      "product_type": None})
                continue
            date, date_note = parse_date(r[0], current_date)
            if not date:
                continue
            current_date = date
            notes = [n for n in [date_note] if n]
            value = number(r[9])
            reason_text = text(r[12])
            sold = not reason_text or bool(value)
            camp, camp_code = campaign(r[3])
            materials = [first(p, MATERIAL_RULES, "outro") for p in split_parts(r[4])] or [None]
            type_parts = split_parts(r[5])
            types = [first(p, TYPE_RULES, "outro") for p in type_parts] or [None]
            refs = [x for x in re.split(r"[/;,\s]+", str(r[2]).replace(".0", "")) if x] if text(r[2]) else []
            count = max(len(types), len(refs), 1)
            items = [{"reference": refs[i] if i < len(refs) else None,
                      "material": materials[min(i, len(materials) - 1)],
                      "product_type": types[min(i, len(types) - 1)]} for i in range(count)]
            if "outro" in types and text(r[5]):
                notes.append(f"tipo: {text(r[5])}")
            obs = text(r[11])
            p = purpose(r[11])
            if obs and (not p or len(plain(obs)) > 25):
                notes.append(obs)
            if reason_text:
                notes.append(f"motivo: {reason_text}")
            if text(r[10]) and restock(r[10]) is None:
                notes.append(f"reposição: {text(r[10])}")
            if text(r[14]):
                notes.append(text(r[14]))
            seen = seen_where(r[7])
            if not seen and obs and "MONTRA" in plain(obs):
                seen = "montra"
            if not seen and obs and "SITE" in plain(obs):
                seen = "site"
            kind = client_type(r[6])
            if not kind and obs and "TURISTA" in plain(obs):
                kind = "passagem"
            row = {
                "store": store, "sale_date": date.isoformat(),
                "sale_number": (str(int(r[1])) if isinstance(r[1], float) else text(r[1])),
                "sold": sold, "total_value": value if sold else None,
                "campaign": camp, "campaign_code": camp_code, "client_type": kind,
                "seen_where": seen, "bought_online": yes_no(r[8]), "purpose": p, "restock": restock(r[10]),
                "no_sale_reason": no_sale(r[12]), "looking_for": text(r[13]),
                "notes": "; ".join(notes)[:1000] or None, "items": items,
            }
            out.append(row)
            last = row
    return merge_sales(out)


def merge_sales(rows):
    """Consecutive rows with the same sale number and day are one sale with several articles."""
    merged = []
    for row in rows:
        prev = merged[-1] if merged else None
        if (prev and row["sale_number"] and prev["sale_number"] == row["sale_number"]
                and prev["store"] == row["store"] and prev["sale_date"] == row["sale_date"]):
            prev["items"] += row["items"]
            if row["total_value"]:
                prev["total_value"] = round((prev["total_value"] or 0) + row["total_value"], 2)
            prev["sold"] = prev["sold"] or row["sold"]
            for key in ("campaign", "campaign_code", "client_type", "seen_where", "bought_online", "purpose",
                        "restock", "no_sale_reason", "looking_for"):
                if prev[key] is None or (key == "campaign" and row[key]):
                    prev[key] = row[key] if row[key] is not None else prev[key]
            if row["notes"] and row["notes"] not in (prev["notes"] or ""):
                prev["notes"] = "; ".join(x for x in (prev["notes"], row["notes"]) if x)[:1000]
            continue
        merged.append(row)
    return merged


def gold_rows(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    out = []
    for ws in wb.worksheets:
        year = int(ws.title[:4])
        name = plain(ws.title)
        operation = "pawn" if ("CONTRATO" in name or "PENHOR" in name) else "used"
        store = None
        for r in ws.iter_rows(min_row=2, values_only=True):
            if isinstance(r[0], str) and r[0].strip():
                store = GOLD_STORES[plain(r[0])]
            month = MONTHS.get(plain(r[1])) if isinstance(r[1], str) else None
            if not store or not month:
                continue
            row = {"store": store, "month": f"{year}-{month:02d}-01", "operation": operation,
                   "visitors": int(r[2]) if isinstance(r[2], (int, float)) else None,
                   "digital_visitors": int(r[3]) if isinstance(r[3], (int, float)) else None}
            for k, g, v in KARATS:
                row[f"grams_{k}"] = number(r[g])
                row[f"value_{k}"] = number(r[v])
            if any(row[c] is not None for c in row if c not in ("store", "month", "operation")):
                out.append(row)
    return out


if __name__ == "__main__":
    sales_path, gold_path, out_dir = sys.argv[1:4]
    sales = sales_rows(sales_path)
    gold = gold_rows(gold_path)
    json.dump(sales, open(f"{out_dir}/sales.json", "w"), ensure_ascii=False)
    json.dump(gold, open(f"{out_dir}/gold_monthly.json", "w"), ensure_ascii=False)
    print(f"{len(sales)} vendas, {len(gold)} meses de compra de ouro")
