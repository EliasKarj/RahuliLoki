# Tunnukset ja pääsynhallinta

Mitä POESESSID on, miksi siihen suhtaudutaan kuin salasanaan, ja mitä token suojaa.

[← takaisin READMEen](../README.md)

---

## POESESSID ja miksi siihen suhtaudutaan näin

`POESESSID` **ei ole rajattu API-avain**. Se on istuntoeväste: sen haltija on kirjautunut
sinuna. Ei kaupankäynnin rajoitusta, ei lukuoikeutta pelkkään arkkuun — koko tili.

Tästä seuraa se, mitä koodi tekee sen kanssa:

| Missä | Mitä tapahtuu |
|-------|---------------|
| Lokit | `registerSecret()` rekisteröi arvon, ja jokainen virhepolku pesee tekstinsä `scrub()`illa. Lisäksi pinon `redact` nollaa `cookie`- ja `authorization`-otsakkeet. |
| Virheilmoitukset | `StashError` pesee viestinsä konstruktorissa. Myös `/api/poll`-vastaus pestään ennen lähetystä. |
| Selain | `/api/config` palauttaa liigan, ajastimen ja kynnysarvot — ei tunnusta. Testi tarkistaa, ettei vastauksessa esiinny edes sanaa `poesessid`. |
| URL | Tunnus kulkee `Cookie`-otsakkeessa eikä koskaan osoitteessa, jossa se päätyisi välityspalvelimen lokiin. |
| Git | `.env` ja `/data` ovat `.gitignore`ssa ensimmäisestä committista alkaen. |

Eväste vanhenee itsestään. Kun se vanhenee, `/api/health` sanoo sen suoraan
(*POESESSID has most likely expired*) sen sijaan että kaavio vain lakkaisi liikkumasta.

> **▸ Miksi kerääjä ei estä käynnistystä ilman tunnusta:** palvelin nousee ilman tunnuksiakin.
> Jo kerätty historia pysyy luettavana, ja `/api/health` kertoo mikä puuttuu. Käynnistymisen
> estäminen veisi kaaviot alas juuri sillä hetkellä kun olet vaihtamassa vanhentunutta
> tunnusta.

### Kyllä, GGG:llä on virallinen OAuth — ja miksi sitä ei käytetä tässä

Tämä on ensimmäinen kysymys jonka kuka tahansa esittää, joten vastaus kuuluu tänne eikä
issueihin.

GGG tarjoaa virallisen OAuth 2.0 -rajapinnan, jossa on `account:stashes`-scope juuri tähän
käyttöön. Se olisi joka mittarilla parempi:

| | POESESSID | OAuth |
|---|---|---|
| Laajuus | **Koko tili.** Kauppa, arkku, viestit | Vain myönnetyt scopet |
| Peruutus | Vaihda salasana | Peru sovelluksen oikeus |
| Vanheneminen | Epämääräinen | Access ~28 pv, refresh ~90 pv |
| Asema | Yksityinen rajapinta | Dokumentoitu ja tuettu |

**Miksi se ei silti käy tähän:** GGG vaatii, että OAuth-sovelluksen redirect URI on HTTPS ja
**rekisteröity verkkotunnus jonka omistat**. IP-osoitteita ja `localhost`ia ei hyväksytä edes
kehityksessä. Lisäksi sovellus pitää rekisteröidä ja saada hyväksytyksi.

Tämä on suorassa ristiriidassa sen kanssa mitä What Remains on. Se sitoutuu oletuksena
silmukkaosoitteeseen, `docker compose` julkaisee portin vain `127.0.0.1`:een, ja koko premissi
on yhden ihmisen itse isännöimä työkalu omalla koneellaan. Sellaisella ei ole verkkotunnusta,
eikä sitä pitäisi tarvitakaan.

Poikkeus on Fly-julkaisu, jolla verkkotunnus on. Jos ajat sitä siellä **ja** saat GGG:ltä
rekisteröinnin läpi, OAuth olisi teknisesti mahdollinen — mutta se ei ole sama sovellus enää:
OAuthin arkkuendpointit ovat eri kuin `character-window/get-stash-items`, joten vastausmuoto,
sivutus ja nopeusrajoitus pitäisi käydä läpi uudelleen.

> **▸ Mitä tästä seuraa sinulle:** kohtele POESESSIDiä salasanana, koska se on sitä. Älä
> liitä sitä issueen, älä kuvakaappaukseen, ja jos epäilet sen vuotaneen, kirjaudu ulos
> kaikilta istunnoilta pathofexile.comilla — se mitätöi evästeen.

> **▸ Tarkkuudesta:** yllä olevat OAuthin yksityiskohdat on luettu toissijaisista lähteistä,
> ei GGG:n dokumentaatiosta suoraan. Tarkista
> [pathofexile.com/developer/docs/authorization](https://www.pathofexile.com/developer/docs/authorization)
> ennen kuin teet päätöksiä niiden varassa — rajapinta on elänyt ja voi elää lisää.

---

## Pääsynhallinta

Tämä sovellus on yhden käyttäjän, mutta *yksi käyttäjä* kertoo kenen **kuuluisi** lukea
dataa — ei kenen on **mahdollista**. Suojattavaa on kolme asiaa: tilin koko varallisuushistoria,
välilehtien nimet, ja `POST /api/poll`, joka kuluttaa tilin GGG-nopeusrajoitusbudjettia
pyynnöstä. Viimeinen on se ikävin: se on juuri se resurssi, jota koko nopeusrajoitin on
olemassa varjelemaan, ja sen loppuun ajaminen johtaa GGG:n aikalisään.

Kolme erillistä porttia, koska ne pysäyttävät kolme eri asiaa:

| Portti | Mitä pysäyttää |
|--------|----------------|
| **Token** | Kenet tahansa, jolla ei ole `AUTH_TOKEN`ia. Vertailu on vakioaikainen, molemmat puolet tiivistetään ensin. |
| **Origin-tarkistus** | Sivun, jolla satut käymään ja joka lähettää `POST /api/poll` selaimesi nimissä. Token ei tässä auta — selain liittäisi sen itse. |
| **Host-tarkistus** | DNS-rebindingin: hyökkääjän verkkonimi osoittaa `127.0.0.1`:een, jolloin selain pitää hänen skriptiään samana originina kuin sinun paneeliasi. |

### Palvelin kieltäytyy käynnistymästä väärässä yhdistelmässä

Yksi asetusyhdistelmä on yksinkertaisesti turvaton: tavoitettavissa koneen ulkopuolelta, eikä
mitään edessä. Siinä tapauksessa `loadConfig` heittää eikä prosessi nouse:

```
refusing to serve an unauthenticated API on 0.0.0.0. This exposes the full wealth history
of the account and a POST /api/poll that spends its GGG rate-limit budget. Set AUTH_TOKEN
(`openssl rand -hex 32`), or bind HOST=127.0.0.1, or set ALLOW_UNAUTHENTICATED=1 if
something in front of it is already authenticating.
```

> **▸ Miksi kaatuminen eikä varoitus:** varoitus lokin rivillä 40 on varoitus, jota kukaan ei
> lue. Ero näiden kahden välillä ei myöskään ole kosmeettinen — toisessa tilin varallisuus on
> julkinen. Kaatuminen käynnistyksessä on ainoa palaute, joka ehtii ajoissa.

> **▸ Miksi `ALLOW_UNAUTHENTICATED` on olemassa:** koska "tavoitettavissa ulkopuolelta" ei aina
> tarkoita "suojaamaton". Compose julkaisee portin `127.0.0.1`:een, Tailscale-liitäntä on
> yksityinen, käänteisproxylla voi olla oma tunnistus. Kontin on silti pakko kuunnella
> `0.0.0.0`:aa ollakseen tavoitettavissa lainkaan. Lippu on kuittaus, ei kytkin: se ei tee
> altistetusta instanssista turvallista.

### `/api/health` vastaa kahdella tavalla

Terveystarkistuksen pitää toimia ennen kuin kukaan on ehtinyt kertoa Dockerille tai Flylle
tokenia, joten se on ainoa reitti tokenin ulkopuolella. Se ei silti kerro kaikkea:

```bash
curl localhost:3000/api/health
# {"status":"up"}

curl -H "Authorization: Bearer $AUTH_TOKEN" localhost:3000/api/health
# {"status":"unconfigured","league":"Settlers","poller":{…},"rateLimit":{…},"prices":{…}}
```

> **▸ Miksi jako:** elävyystarkistus tarvitsee tiedon "vastaako prosessi". Kerääjän
> virheilmoitukset, tilin sijainti GGG:n nopeusrajoittimessa ja hintojen ikä ovat diagnostiikkaa
> nimetystä tilistä. Ne kaksi asiaa eivät kuulu samaan vastaukseen.

### Token selaimessa

Selain kysyy tokenin kerran ja pitää sen `sessionStorage`ssa — se kuolee välilehden mukana.
Token lähtee `Authorization`-otsakkeessa, ei koskaan evästeenä eikä osoitteessa.

> **▸ Miksi ei evästettä:** eväste liitetään automaattisesti myös hyökkääjän sivun
> lähettämään pyyntöön, mikä on koko CSRF-ongelma. Otsake pakottaa esitarkistuksen, jota
> selain ei tee vieraalle originille.
