# Kehitys

Asetukset, rajapinta, testit ja projektin rakenne.

[← back to the README](../README.md)

---

## Asetukset

Kaikki `.env`-tiedostossa; `.env.example` on malli.

| Muuttuja | Oletus | Merkitys |
|----------|--------|----------|
| `POESESSID` | — | Istuntoeväste. Pakollinen keräämiseen. |
| `POE_ACCOUNT_NAME` | — | Tilin nimi täsmälleen kuten GGG sen kirjoittaa, `Exile#1234`. |
| `POE_LEAGUE` | `Standard` | Seurattava liiga. Tilannekuvat avaimitetaan tällä. |
| `POLL_CRON` | `*/10 * * * *` | Keräysväli. Tarkistetaan käynnistyksessä, ei vasta ensimmäisellä herätyksellä. Työpöytäversiossa tämä valitaan valikosta minuutteina. |
| `MIN_ITEM_CHAOS` | `2` | Tätä halvemmat *yhteenlasketut* erät jätetään erittelystä pois. |
| `TRACKED_TABS` | tyhjä | Pilkulla erotellut välilehtien nimet. Tyhjä = kaikki. |
| `PRICE_TTL_MINUTES` | `60` | Kuinka vanhaa hintasettiä käytetään ennen uutta hakua. |
| `PRICE_CURRENCY_CATEGORIES` | `Currency,Fragment` | poe.ninjan `currencyoverview`-tyypit. |
| `PRICE_ITEM_CATEGORIES` | ks. alla | poe.ninjan `itemoverview`-tyypit. |
| `POE_NINJA_URL` | `https://poe.ninja/poe1/api/economy/exchange/current` | poe.ninjan API-juuri. Vain jos se siirtyy taas. |
| `POE_CONTACT` | — | Yhteystieto, joka liitetään `User-Agent`iin. |
| `DATABASE_URL` | `file:./data/what-remains.db` | SQLite-tiedosto. |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | HTTP. Oletus on silmukkaosoite, ei kaikki verkkoliitännät. |
| `AUTH_TOKEN` | tyhjä | Jaettu API-token. Pakollinen kun sidos ei ole silmukkaosoite. |
| `ALLOW_UNAUTHENTICATED` | tyhjä | Kuittaus siitä, että joku muu hoitaa tunnistuksen. |
| `ALLOWED_HOSTS` | tyhjä | Sallitut `Host`-otsakkeet tokenittomassa tilassa. |
| `TRUST_PROXY` | tyhjä | Uskotaanko `X-Forwarded-*`. Vain oikean proxyn takana. |
| `PRICE_SET_RETENTION` | `48` | Säilytettävät hintasetit liigaa kohti. `0` = kaikki. Sisältää myös ikonikartan. |
| `REQUEST_TIMEOUT_MS` | `30000` | Yhden ulkoisen pyynnön katto. |
| `LOG_LEVEL` | `info` | pinon taso. |

Oletushintakategoriat: `DivinationCard, Essence, Fossil, Resonator, Scarab, Oil, DeliriumOrb,
Incubator, Artifact, Vial, Omen, Tattoo`.

> **▸ Miksi jalokivet ja kartat puuttuvat oletuksesta:** ne eivät mene nimellä. Jalokiven
> hinta riippuu tasosta, laadusta ja turmeluksesta; kartan tasosta; klusterikorun siitä mitä
> siihen osui. Nimellä arvostaminen antaisi niille jonkin luvun, ja se luku olisi väärä
> tavalla, jota ei kaaviosta huomaa.
>
> **▸ Miksi uniikit ovat mukana, vaikka nekään eivät mene nimellä:** koska niille on olemassa
> oikea avain. poe.ninja palauttaa yhden rivin jokaiselle yhdistelmälle ja kertoo rivillä
> `links` ja `corrupted`; aarrearkun esine kertoo omat pistokkaansa ja turmeluksensa. Avain on
> siis `(nimi, linkit, turmelus)`, ei nimi. Sama Bronn's Lithe on 5 chaosia linkittömänä ja
> 210 kuutoslinkkinä — nimellä arvostettuna toinen niistä olisi ollut väärässä
> nelikymmenkertaisesti.
>
> Erittelyssä ne näkyvät erillisinä riveinä (`Bronn's Lithe`, `Bronn's Lithe (6L)`), koska
> yhteen niputettuna kaavio piilottaisi juuri sen syyn, miksi luku liikkui.
>
> **▸ Mitä tämä ei vieläkään ratkaise:** variantit. poe.ninja erottaa esimerkiksi
> 3.0:aa edeltävän Shavronne's Wrappingsin nykyisestä, eikä aarrekaapin datassa ole mitään
> mikä kertoisi kumpi sinulla on. Kun rivit eroavat vain variantilta, käytetään **halvinta**.
> Molemmat suunnat ovat väärin, mutta yliarvio näkyy kaaviossa tuottona jota ei tullut.

> **▸ Miksi uniikit eivät ole enää mukana:** poe.ninja suunnitteli API:nsa uusiksi, eikä
> hintariveillä ole enää `links`- eikä `corrupted`-kenttää. Ilman niitä varianttia ei voi
> tunnistaa, ja uniikin hinnoittelu pelkällä nimellä valitsisi hiljaa jommankumman: sama
> Bronn's Lithe on ~5 chaosia linkittömänä ja ~210 kuutoslinkkinä.
>
> Vaihtoehdot olivat luku joka on väärässä nelikymmenkertaisesti ilman mitään merkkiä siitä, tai
> ei lukua lainkaan. Uniikit jäävät siis hinnoittelematta ja näkyvät kierroksen "ei hintaa"
> -varoituksessa. Jos poe.ninja alkaa taas julkaista varianttikenttiä, `PRICE_UNIQUE_CATEGORIES`
> kytkee ne takaisin.

---

## API

Kaikki `/api`-alkuiset, kaikki JSONia.

| Reitti | Mitä |
|--------|------|
| `GET /api/snapshots?league=&from=&to=&limit=` | Tilannekuvat vanhin ensin. Erittely mukaan vain `?full=1`; `?tabs=1` antaa välilehtikohtaiset summat ilman esinetason dataa. |
| `GET /api/snapshots/latest?league=` | Tuorein tilannekuva täydellä erittelyllä, välilehtisummilla ja kärkiomistuksilla ikoneineen. 404 ennen ensimmäistä kierrosta. |
| `GET /api/stats?league=&from=&to=` | Tuotto, c/h aktiivinen ja seinäkello, aktiivitunnit, paras tunti, välikohtaiset tiedot. |
| `GET /api/changes?league=&from=&to=&minChaos=` | Mikä liikkui aikavälin päiden välillä: esinekohtaiset muutokset, syy (`quantity`/`price`/`both`), voitot ja tappiot erikseen. |
| `GET /api/item-history?name=&league=&from=` | Yhden esineen määrä ja arvo jokaisessa aikavälin tilannekuvassa. |
| `GET /api/leagues` | Nykyiset liigat GGG:ltä työpöytäversion valikkoa varten. Välimuistissa 6 h; epäonnistuessa pysyvät liigat. |
| `GET /api/account` | Kenelle tallennettu istunto GGG:n mukaan kuuluu, ja täsmääkö se `POE_ACCOUNT_NAME`iin. 502 kun GGG ei suostu vastaamaan — se itsessään on vastaus. |
| `POST /api/poll` | Käynnistää kierroksen ja vastaa **202 heti**, ei kierroksen päätyttyä. 409 jos kierros on jo kesken, 503 jos tunnukset puuttuvat. Lopputulos luetaan `/api/health`istä. |
| `GET /api/health` | Viimeisin onnistuminen, pysäytyksen syy, nopeusrajoituksen tila, hintojen ikä ja `schedule.nextRunAt`: milloin seuraava automaattinen kierros ajetaan. |
| `GET /api/config` | Liiga, ajastin, kynnysarvot, liigat joilla on historiaa. **Ei POESESSIDiä.** |

Kun `AUTH_TOKEN` on asetettu, jokainen näistä vaatii `Authorization: Bearer …` -otsakkeen
(`X-Auth-Token` käy myös). Ainoa poikkeus on `/api/health`, joka vastaa tokenitta `{"status":"up"}`
ja täydellä diagnostiikalla vasta tunnistettuna — ks. [Pääsynhallinta](turvallisuus.md#pääsynhallinta).

`/api/health` vastaa **200 aina kun prosessi on pystyssä**, myös pysäytettynä.

> **▸ Miksi ei 503 pysäytettynä:** kontin terveystarkistus käynnistäisi prosessin uudelleen, ja
> uudelleenkäynnistys ei korjaa vanhentunutta POESESSIDiä. Se vain käynnistäisi konttia
> silmukassa päiväkausia. Kentässä `status` lukee `halted`, ja sivun yläreuna sanoo sen ihmiselle.

---

## Komennot

```bash
pnpm dev            # palvelin + selainpuoli rinnakkain
pnpm dev:server
pnpm dev:web
pnpm db:migrate     # kehitysmigraatio
pnpm db:studio      # Prisma Studio
pnpm build          # selainpuoli ja palvelin
pnpm test
pnpm typecheck
```

Palvelin ajaa TypeScriptiä suoraan Noden tyyppienriisunnalla — käännösvaihetta ei ole
kehityksessä, `tsc` vain tuottaa `dist`in julkaisua varten.

### Uskottavaa dataa ilman odottelua

```bash
pnpm --filter @whatremains/server seed -- --days 4 --league Settlers
```

Kolme päivää tilannekuvia nukkumisjaksoineen, ajelehtivine divine-kursseineen ja satunnaisine
kauppoineen. Kieltäytyy koskemasta liigaan, jolla on jo tilannekuvia, ellei anna `--force`.

> **▸ Miksi tämä on olemassa:** kaavioiden arvioiminen vaatii dataa, jolla on oikean datan muoto.
> Kolmen vuorokauden odottaminen sen selvittämiseksi, että työkaluvinkki menee akselin päälle,
> ei ole työtapa.

---

## Riippuvuuksien tarkistus

CI ajaa `pnpm audit --audit-level moderate` ja kaataa käännöksen tunnettuun haavoittuvuuteen.
Yksi neuvonta on ohitettu, `package.json`in `pnpm.auditConfig.ignoreGhsas`issa:

**[GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)** — `extract-zip`,
validoimaton symlinkkien polkuhyppäys purettaessa. Korjattua versiota **ei ole olemassa**
(`Patched versions: <0.0.0`); paketti on ylläpitämätön.

> **▸ Miksi tämä on hyväksyttävä poikkeus:** `extract-zip` tulee Electronin *asennusskriptin*
> mukana, ja sen ainoa tehtävä on purkaa Electronin oma binääri kehittäjän koneella. Se ei ole
> mukana julkaistussa ohjelmassa, sitä ei aja mikään tämän repon koodi, eikä se pura mitään
> muuta kuin Electronin oman GitHub-julkaisun. Haavoittuvuus edellyttää vihamielistä
> zip-tiedostoa, jollaista tässä ketjussa ei ole.
>
> Ohitus on nimenomaisesti tuossa yhdessä paikassa eikä kynnysarvoa laskemalla, jotta se on
> yhden rivin muutos diffissä eikä kokonaisen portin hiljainen sammuttaminen.

---

## Testit

```bash
pnpm test
```

**457 testiä**, ei yhtään verkkopyyntöä:

- **Nopeusrajoitin** — otsakkeiden jäsennys, tahdistus, sarjallistuminen, `Retry-After`,
  kaksinkertaistuminen kattoon asti. Kello ja uni ovat väärennettyjä, joten 30 minuutin
  perääntymisen testaaminen kestää mikrosekunteja.
- **Hinnat** — nauhoitetut poe.ninja-vastaukset, myös rikkinäiset: null-hinta, tyhjä
  `lines`, HTML JSONin sijaan.
- **Arkku** — nauhoitetut GGG-vastaukset merkkauksineen. Yhden välilehden kaatuminen kaataa
  kierroksen; tunnus ei vuoda virheilmoitukseen.
- **Arvostus** — nimien selvitys, pinojen yhdistäminen, kynnysarvo, ohitetut kategoriat.
- **Sarjat** — jouten-sääntö, epätasaiset välit, piikin merkintä, paras tunti.
- **Kerääjä** — mitään ei kirjoiteta kun jokin kaatuu; perääntyminen; pysäytys kolmen jälkeen;
  käsin ajo purkaa pysäytyksen.
- **API** — jokainen reitti `app.inject()`illa väärennetyllä varastolla.
- **Selainpuoli** — muotoilusäännöt, kaavioiden muodonmuutokset, ja esinetaulukon niputus
  välilehtien yli, haku ja lajittelu.
- **Kirjautuminen** — että anonyymi eväste *ei* kelpaa istunnoksi, että GGG:n myöhemmin
  antama kelpaa, ettei samaa evästettä kysytä GGG:ltä joka kierroksella, ja että odotus
  loppuu aikakatkaisuun eikä jää polkemaan.

---

## Projektin rakenne

```
/server
  /src
    /services   priceService, stashService, valuationService, uniques, snapshotRepo
    /routes     snapshots, health, config
    /jobs       pollJob
    /lib        rateLimiter, logger, series, changes, config, auth, http, schedule
    app.ts      Fastifyn kokoaminen (testattavissa ilman kuuntelevaa porttia)
    server.ts   palvelimen kokoaminen funktiona (työpöytäversio upottaa saman)
    index.ts    komentorivikäärö: käynnistys ja siisti sammutus
  /prisma       schema.prisma + migraatiot
  /tools        seed.ts
/desktop
  /src          main (Electron), login (kirjautumisikkuna), settings, preload,
                adoptOldData (vanhan nimen datahakemisto), sessionWait, loginHosts
/scripts        with-env.mjs (lataa juuren .env Prisma CLI:lle)
/web
  /src
    /components Hero, NetWorthChart, RatePerHourChart, TabBreakdown, SnapshotTable,
                PollerStatus, TokenGate, ChangesTable, ItemHistory, ItemIcon, DesktopSetup
    /hooks      useSnapshots
    /lib        api, format, series, palette (kaavioiden värit), schedule (laskuri), spark
```

Tilastot lasketaan palvelimella ja tulevat selaimeen valmiina. Jouten-sääntö ja piikkien
merkintä ovat siis olemassa **tasan yhtenä toteutuksena** — kaksi rinnakkaista ehtisi erkaantua
toisistaan ensimmäiseen muutokseen mennessä.

---

## Mitä tämä ei tee

- **Ei useita käyttäjiä, ei kirjautumista, ei jakamista.** Yksi käyttäjä, yksi GGG-tili.
- **Ei kolmansien osapuolten sivustojen kaapimista.** GGG ja poe.ninja suoraan.
- **Ei PoE2-tukea.** GGG ei tarjoa julkista PoE2-arkkurajapintaa. Liiga-asetus ei sulje ovea,
  mutta mitään ei ole rakennettu sen varaan.
- **Ei kaupankäyntiä, craft-laskureita eikä flippityökaluja.**

Varhaisen liigan hinnat heiluvat rajusti, koska markkinaa ei vielä ole. Kaavion heilunta
ensimmäisinä päivinä ei ole varallisuuden liikettä vaan poe.ninjan epävarmuutta.
