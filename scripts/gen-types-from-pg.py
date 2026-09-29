#!/usr/bin/env python3
"""Generate a supabase-js compatible `Database` type from a local Postgres (used when the Supabase CLI
is unavailable). Normal path: `npm run db:types` (supabase gen types). Usage: gen-types-from-pg.py <psql cmd>"""
import json, subprocess, sys
PSQL = sys.argv[1] if len(sys.argv) > 1 else "psql -d fsmb"
def q(sql):
    out = subprocess.run(PSQL.split() + ["-X", "-A", "-t", "-c", f"select coalesce(json_agg(x), '[]') from ({sql}) x"],
                         capture_output=True, text=True, check=True).stdout.strip()
    return json.loads(out)
enums = q("""select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
             from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
             where n.nspname = 'public' group by t.typname order by 1""")
enum_names = {e["name"] for e in enums}
cols = q("""select c.relname as rel, c.relkind as kind, a.attname as col, format_type(a.atttypid, null) as type,
                   t.typname as typname, t.typcategory as cat, et.typname as elem, not a.attnotnull as nullable,
                   (a.atthasdef or a.attidentity <> '' or a.attgenerated <> '') as has_default,
                   a.attgenerated <> '' as generated, a.attidentity = 'a' as identity_always, a.attnum
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
            join pg_type t on t.oid = a.atttypid left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
            where n.nspname = 'public' and c.relkind in ('r', 'v') order by c.relname, a.attnum""")
fks = q("""select con.conname as name, c.relname as rel, rc.relname as ref, rn.nspname as refschema,
                  array(select a.attname from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k) as cols,
                  array(select a.attname from unnest(con.confkey) k join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k) as refcols
           from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
           join pg_class rc on rc.oid = con.confrelid join pg_namespace rn on rn.oid = rc.relnamespace
           where con.contype = 'f' and n.nspname = 'public' order by 1""")
funcs = q("""select p.proname as name, p.proretset as setof, p.pronargdefaults as ndef,
                    coalesce(p.proargnames, '{}') as argnames, coalesce(p.proargmodes::text[], '{}') as argmodes,
                    array(select format_type(u.t, null) from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality u(t, i) order by u.i) as argtypes,
                    array(select (select tt.typname from pg_type tt where tt.oid = u.t) from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality u(t, i) order by u.i) as argtypnames,
                    format_type(p.prorettype, null) as rettype, rt.typname as rettypname, rt.typtype as rettyptype
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type rt on rt.oid = p.prorettype
             where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'custom_access_token_hook' order by 1""")
NUM = {"int2", "int4", "int8", "numeric", "float4", "float8"}
def ts(typname, cat=None, elem=None):
    if cat == "A" or (typname or "").startswith("_"):
        base = elem or typname[1:]
        return f"({ts(base)})[]"
    if typname in enum_names: return f'Database["public"]["Enums"]["{typname}"]'
    if typname in NUM: return "number"
    if typname == "bool": return "boolean"
    if typname in ("json", "jsonb"): return "Json"
    return "string"
rels = {}
for c in cols: rels.setdefault((c["rel"], c["kind"]), []).append(c)
def rel_block(rel):
    items = [f['name'] for f in fks if f['rel'] == rel]
    out = []
    for f in fks:
        if f["rel"] != rel: continue
        out.append("          {\n" f'            foreignKeyName: "{f["name"]}"\n            columns: {json.dumps(f["cols"])}\n'
                   f'            isOneToOne: false\n            referencedRelation: "{f["ref"]}"\n'
                   f'            referencedColumns: {json.dumps(f["refcols"])}\n          }}')
    return "[\n" + ",\n".join(out) + "\n        ]" if out else "[]"
L = ["// Generated from the FSMB migrations (01–19). Regenerate with `npm run db:types`.",
     "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]", "",
     "export type Database = {", "  public: {", "    Tables: {"]
for (rel, kind), cs in rels.items():
    if kind != "r": continue
    L.append(f"      {rel}: {{")
    L.append("        Row: {"); [L.append(f"          {c['col']}: {ts(c['typname'], c['cat'], c['elem'])}{' | null' if c['nullable'] else ''}") for c in cs]; L.append("        }")
    L.append("        Insert: {")
    for c in cs:
        if c["generated"] or c["identity_always"]:
            L.append(f"          {c['col']}?: never"); continue
        opt = "?" if (c["nullable"] or c["has_default"]) else ""
        L.append(f"          {c['col']}{opt}: {ts(c['typname'], c['cat'], c['elem'])}{' | null' if c['nullable'] else ''}")
    L.append("        }")
    L.append("        Update: {")
    for c in cs:
        if c["generated"] or c["identity_always"]:
            L.append(f"          {c['col']}?: never"); continue
        L.append(f"          {c['col']}?: {ts(c['typname'], c['cat'], c['elem'])}{' | null' if c['nullable'] else ''}")
    L.append("        }")
    L.append(f"        Relationships: {rel_block(rel)}")
    L.append("      }")
L += ["    }", "    Views: {"]
for (rel, kind), cs in rels.items():
    if kind != "v": continue
    L.append(f"      {rel}: {{"); L.append("        Row: {")
    for c in cs: L.append(f"          {c['col']}: {ts(c['typname'], c['cat'], c['elem'])} | null")
    L.append("        }"); L.append("        Relationships: []"); L.append("      }")
L += ["    }", "    Functions: {"]
for f in funcs:
    names, modes, types, tnames = f["argnames"], f["argmodes"], f["argtypes"], f["argtypnames"]
    ins, outs = [], []
    for i, nm in enumerate(names):
        mode = modes[i] if modes else "i"
        (outs if mode in ("t", "o") else ins).append((nm, tnames[i]))
    nin = len(ins); first_default = nin - (f["ndef"] or 0)
    args = "; ".join(f"{nm}{'?' if i >= first_default else ''}: {ts(tn)}" for i, (nm, tn) in enumerate(ins))
    if outs:
        row = "{ " + "; ".join(f"{nm}: {ts(tn)}" for nm, tn in outs) + " }"
        ret = f"{row}[]" if f["setof"] else row
    elif f["rettypname"] in [r for (r, k) in rels]:
        ret = f'Database["public"]["Tables"]["{f["rettypname"]}"]["Row"]' + ("[]" if f["setof"] else "")
    elif f["rettypname"] == "void": ret = "undefined"
    else: ret = ts(f["rettypname"])
    L.append(f"      {f['name']}: {{ Args: {{ {args} }}{' ' if not args else ''}; Returns: {ret} }}".replace("{  }", "Record<PropertyKey, never>").replace("Args: Record<PropertyKey, never> ;", "Args: Record<PropertyKey, never>;"))
L += ["    }", "    Enums: {"]
for e in enums: L.append(f"      {e['name']}: " + " | ".join(json.dumps(x) for x in e["labels"]))
L += ["    }", "    CompositeTypes: { [_ in never]: never }", "  }", "}", "",
      'type PublicSchema = Database["public"]',
      'export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]',
      'export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]',
      'export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]',
      'export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"]',
      'export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T]',
      'export type Fn<T extends keyof PublicSchema["Functions"]> = PublicSchema["Functions"][T]', ""]
print("\n".join(L))
