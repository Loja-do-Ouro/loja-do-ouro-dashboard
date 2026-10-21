const { test } = require("node:test");
const assert = require("node:assert/strict");
const ps = require("../.test-build/private-selection-rules.js");

test("Two brands with the Private Selection name in English, and six languages", () => {
  assert.deepEqual([...ps.PS_LOCALES], ["pt", "en", "es", "fr", "de", "it"]);
  assert.equal(ps.brandName("ldo"), "Loja do Ouro Private Selection");
  assert.equal(ps.brandName("gsp"), "Gold Store Premium Private Selection");
  assert.equal(ps.isBrand("ldo"), true);
  assert.equal(ps.isBrand("LDO"), false);
  assert.equal(ps.isLocale("it"), true);
  assert.equal(ps.isLocale("pt-PT"), false);
  assert.equal(ps.pickLocale("pt-PT"), "pt");
  assert.equal(ps.pickLocale(" IT "), "it");
  assert.equal(ps.pickLocale("es_ES"), "es");
  assert.equal(ps.pickLocale("nl"), "en");
  assert.equal(ps.pickLocale(null, "pt"), "pt");
  for (const l of ps.PS_LOCALES) assert.match(ps.PS_INTL[l], new RegExp(`^${l}-[A-Z]{2}$`));
});

test("Loja do Ouro only in Portuguese with the country Portugal; everything else is Gold Store Premium", () => {
  assert.equal(ps.brandFor("pt", "PT"), "ldo");
  assert.equal(ps.brandFor("pt-PT", "pt"), "ldo");
  assert.equal(ps.brandFor("pt"), "ldo", "no country (dashboard) counts as Portugal");
  assert.equal(ps.brandFor("pt", "BR"), "gsp");
  assert.equal(ps.brandFor("en", "PT"), "gsp");
  assert.equal(ps.brandFor("es", "ES"), "gsp");
  assert.equal(ps.brandFor("pt", null), "gsp");
  // Valores da BD: marca inválida → Gold Store Premium; língua inválida → a da raiz do domínio.
  assert.deepEqual(ps.psLang("ldo", "xx"), { brand: "ldo", locale: "pt" });
  assert.deepEqual(ps.psLang("zzz", null), { brand: "gsp", locale: "en" });
  assert.deepEqual(ps.psLang("gsp", "de"), { brand: "gsp", locale: "de" });
});

test("Both brands' sites may call the API; PRIVATE_SELECTION_ORIGINS replaces the list", () => {
  const before = { ps: process.env.PRIVATE_SELECTION_ORIGINS, chat: process.env.SITE_CHAT_ORIGINS };
  try {
    delete process.env.PRIVATE_SELECTION_ORIGINS;
    process.env.SITE_CHAT_ORIGINS = "https://chat.example";
    assert.deepEqual(ps.psOrigins(), ps.PS_DEFAULT_ORIGINS, "the chat list does not leak into the Private Selection");
    for (const o of ["https://www.lojadoouro.pt", "https://lojadoouro.pt", "https://lojadoouro-online.myshopify.com", "https://www.goldstorepremium.com", "https://goldstorepremium.com"])
      assert.ok(ps.PS_DEFAULT_ORIGINS.includes(o), o);
    process.env.PRIVATE_SELECTION_ORIGINS = "https://Loja.example/, http://inseguro.example";
    assert.deepEqual(ps.psOrigins(), ["https://loja.example"]);
    process.env.PRIVATE_SELECTION_ORIGINS = "lixo";
    assert.deepEqual(ps.psOrigins(), ps.PS_DEFAULT_ORIGINS);
  } finally {
    for (const [k, v] of [["PRIVATE_SELECTION_ORIGINS", before.ps], ["SITE_CHAT_ORIGINS", before.chat]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("The email button opens the brand's domain in the member's language", () => {
  const path = ps.PS_DEFAULT_ENTRY_PATH;
  assert.equal(path, "/products/pulseira-marquesa-em-ouro-19kl-20-1cm?view=private-selection");
  // Só as línguas que cada domínio tem no Shopify Markets; as outras abrem na língua principal do domínio.
  const ldo = { pt: "", en: "/en", es: "/es", fr: "/fr", de: "/de", it: "" };
  const gsp = { en: "", es: "/es", pt: "/pt-pt", fr: "", de: "", it: "" };
  for (const l of ps.PS_LOCALES) {
    assert.equal(ps.entryUrl("ldo", l, path), `https://www.lojadoouro.pt${ldo[l]}${path}`, `ldo ${l}`);
    assert.equal(ps.entryUrl("gsp", l, path), `https://www.goldstorepremium.com${gsp[l]}${path}`, `gsp ${l}`);
  }
  assert.equal(ps.entryUrl("gsp", "es", "/collections/pulseiras"), "https://www.goldstorepremium.com/es/collections/pulseiras");
  // Um prefixo de língua no caminho é trocado pelo do cliente.
  assert.equal(ps.entryUrl("gsp", "pt", "/en/products/anel?view=private-selection"), "https://www.goldstorepremium.com/pt-pt/products/anel?view=private-selection");
  assert.equal(ps.entryUrl("ldo", "pt", "/pt-pt/products/anel"), "https://www.lojadoouro.pt/products/anel");
  assert.equal(ps.entryUrl("ldo", "fr", "/en"), "https://www.lojadoouro.pt/fr/");
  assert.equal(ps.entryUrl("ldo", "pt", "/de?view=x"), "https://www.lojadoouro.pt/?view=x");
  assert.equal(ps.entryUrl("ldo", "pt", "/products/especial"), "https://www.lojadoouro.pt/products/especial", "a word that only starts like a language stays");
  assert.equal(ps.entryUrl("ldo", "pt", "/italia"), "https://www.lojadoouro.pt/italia");
  // Caminho em falta ou inválido (outro site, //, \, espaços): o de origem, sempre no domínio da marca.
  for (const bad of [null, undefined, "", "products/x", "https://evil.example/x", "//evil.example/x", "/\\evil.example", "/a b", 42])
    assert.equal(ps.entryUrl("ldo", "pt", bad), `https://www.lojadoouro.pt${path}`, String(bad));
  // Valores fora da lista: Gold Store Premium em inglês.
  assert.equal(ps.entryUrl("xx", "nl", path), `https://www.goldstorepremium.com${path}`);
});

test("Names are trimmed and must look like a person's name (no links, digits or markup)", () => {
  assert.equal(ps.cleanName("  Ana   Maria\tSilva  "), "Ana Maria Silva");
  for (const ok of ["María José O'Neil-Smith", "Jürgen Müller", "Mª João", "J.R.R. Tolkien", "Zoë D’Arcy", "王小明", "Ole"])
    assert.equal(ps.cleanName(ok), ok, ok);
  assert.equal(ps.cleanName("Ana\u0000 Silva"), "Ana Silva");
  for (const bad of ["A", " ", "Ana 2", "<b>Ana</b>", "ana@exemplo.pt", "https://spam.example", "www.spam.example", "Ganhe já spam.com", "Ana/Rui", "x".repeat(81), "-Ana", null, 42, {}])
    assert.equal(ps.cleanName(bad), null, String(bad));
  assert.equal(ps.firstName("  Ana Maria "), "Ana");
  assert.equal(ps.firstName(null), "");
});

test("Emails are trimmed and lowercased", () => {
  assert.equal(ps.cleanEmail("  Ana.Silva@Exemplo.PT "), "ana.silva@exemplo.pt");
  for (const bad of ["ana", "ana@exemplo", "a b@c.pt", "", null, 1]) assert.equal(ps.cleanEmail(bad), null, String(bad));
});

test("Mobile numbers become E.164; Portuguese numbers have 9 digits", () => {
  assert.equal(ps.normalizePhone("+351 912 345 678"), "+351912345678");
  assert.equal(ps.normalizePhone("00351 912-345-678"), "+351912345678");
  assert.equal(ps.normalizePhone("(+351) 912.345.678"), "+351912345678");
  assert.equal(ps.normalizePhone("+351 912 345 678"), "+351912345678");
  assert.equal(ps.normalizePhone("+44 (0)7700 900123"), "+447700900123");
  assert.equal(ps.normalizePhone("+33 6 12 34 56 78"), "+33612345678");
  assert.equal(ps.normalizePhone("+39 06 1234 5678"), "+390612345678", "Italian numbers keep their 0");
  assert.equal(ps.normalizePhone("+34 612 34 56 78"), "+34612345678");
  // Sem indicativo: só com o indicativo por omissão.
  assert.equal(ps.normalizePhone("912 345 678"), null);
  assert.equal(ps.normalizePhone("912 345 678", "+351"), "+351912345678");
  assert.equal(ps.normalizePhone("912 345 678", "351"), null);
  assert.equal(ps.normalizePhone("+44 7700 900123", "+351"), "+447700900123");
  for (const bad of ["+351 91234567", "+351 9123456789", "+351 012345678", "+0 123456789", "+12345", "+1234567890123456", "abc", "+351 912 345 678 ext 2", "91+2345678", "", null, 912345678, "1".repeat(41)])
    assert.equal(ps.normalizePhone(bad), null, String(bad));
});

test("The shared password has 8 to 100 characters (as in the database) and no spaces at the ends", () => {
  assert.equal(ps.PS_PASSWORD_MIN, 8);
  assert.equal(ps.PS_PASSWORD_MAX, 100);
  for (const ok of ["Ouro2026", "uma senha longa com espaços", "x".repeat(100)]) assert.equal(ps.validPassword(ok), true, ok);
  for (const bad of ["curta", "1234567", " Ouro2026", "Ouro2026 ", "Ouro\n2026", "x".repeat(101), null, 12345678])
    assert.equal(ps.validPassword(bad), false, String(bad));
});

const member = {
  email: " Ana.Silva@Exemplo.PT ", name: "Ana Maria Silva", phone: "+351912345678", locale: "pt", brand: "ldo", source: "form",
  consent_marketing: true, consent_at: "2026-10-21T10:00:00Z", created_at: "2026-10-21T10:00:00Z",
};

test("The Klaviyo profile carries the name and the Private Selection details, with the phone only as a property", () => {
  assert.deepEqual(ps.klaviyoProfilePayload(member), {
    data: {
      type: "profile",
      attributes: {
        email: "ana.silva@exemplo.pt",
        first_name: "Ana",
        last_name: "Maria Silva",
        properties: {
          ps_brand: "ldo", ps_locale: "pt", ps_source: "form", ps_requested_at: "2026-10-21T10:00:00Z",
          ps_marketing_consent: true, ps_phone: "+351912345678", ps_consent_at: "2026-10-21T10:00:00Z",
        },
      },
    },
  });
  // Sem consentimento (e sem apelido nem telemóvel): nada de consentimento no perfil.
  const plain = ps.klaviyoProfilePayload({ ...member, name: "Ana", phone: null, brand: "gsp", locale: "it", source: "admin", consent_marketing: false });
  assert.deepEqual(plain.data.attributes, {
    email: "ana.silva@exemplo.pt",
    first_name: "Ana",
    properties: { ps_brand: "gsp", ps_locale: "it", ps_source: "admin", ps_requested_at: "2026-10-21T10:00:00Z", ps_marketing_consent: false },
  });
  assert.equal("phone_number" in plain.data.attributes, false);
  assert.equal("phone_number" in ps.klaviyoProfilePayload(member).data.attributes, false);
  // Nome do formulário num perfil que a Klaviyo já tem: fica de fora (o resto segue).
  const kept = ps.klaviyoProfilePayload(member, { names: false }).data.attributes;
  assert.equal("first_name" in kept, false);
  assert.equal("last_name" in kept, false);
  assert.equal(kept.email, "ana.silva@exemplo.pt");
  assert.equal(kept.properties.ps_source, "form");
  assert.deepEqual(ps.klaviyoProfilePayload(member, {}), ps.klaviyoProfilePayload(member));
});

test("Only members who ticked the box are subscribed to marketing; list changes go by profile id", () => {
  assert.equal(ps.klaviyoSubscriptionPayload({ ...member, consent_marketing: false }, "LIST1"), null);
  assert.equal(ps.klaviyoSubscriptionPayload({ ...member, consent_marketing: "true" }, "LIST1"), null);
  const job = ps.klaviyoSubscriptionPayload(member, "LIST1");
  assert.deepEqual(job, {
    data: {
      type: "profile-subscription-bulk-create-job",
      attributes: {
        custom_source: "Loja do Ouro Private Selection",
        profiles: { data: [{ type: "profile", attributes: { email: "ana.silva@exemplo.pt", subscriptions: { email: { marketing: { consent: "SUBSCRIBED" } } } } }] },
      },
      relationships: { list: { data: { type: "list", id: "LIST1" } } },
    },
  });
  // A Klaviyo recusa consented_at fora das importações históricas.
  assert.doesNotMatch(JSON.stringify(job), /consented_at|historical_import|sms/i);
  assert.equal(ps.klaviyoSubscriptionPayload({ ...member, brand: "gsp" }, "L").data.attributes.custom_source, "Gold Store Premium Private Selection");
  assert.deepEqual(ps.klaviyoListPayload(["01ABC", "01DEF"]), { data: [{ type: "profile", id: "01ABC" }, { type: "profile", id: "01DEF" }] });
});
