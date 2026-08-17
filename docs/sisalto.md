# Mistä luvut tulevat

GGG:n nopeusrajoitus, poe.ninjan hinnat ja esineiden nimien selvitys.

[← takaisin READMEen](../README.md)

---

## Nopeusrajoitus

GGG bannaa herkästi. Tämä on koodin se osa, jota kannattaa lukea ennen kuin muuttaa mitään.

Jokainen vastaus kertoo voimassa olevan säännön ja oman tilanteen:

```
X-Rate-Limit-Account:       45:60:120,180:3600:3600
X-Rate-Limit-Account-State:  2:60:0,  17:3600:0
```

Kolmikko on `osumat:jakso:rangaistus`. Rajoitin

- **tahdistaa** sen mukaan **paljonko ämpärissä on jäljellä**, ei sen keskimääräisen
  täyttymisnopeuden mukaan: ensimmäinen puolikas budjetista saa kulua vapaasti, ja sen jälkeen
  viive kiihtyy tasaisesti täyteen `jakso / osumat` -vauhtiin siihen mennessä kun ämpäri on
  tyhjä;
- **sarjallistaa** pyynnöt — yksi kerrallaan, ei koskaan rinnakkain;
- **odottaa koko jakson** kun ämpäri on tyhjä, ja ilmoitetun ajan kun tila kertoo rangaistuksesta;
- **kunnioittaa `Retry-Afteria`** 429:ssä ja kaksinkertaistaa siitä 30 minuuttiin asti;
- **luovuttaa** `RateLimitError`illa sen sijaan että jatkaisi hakkaamista.

> **▸ Miksi jäljellä olevan mukaan eikä keskinopeudella:** aiempi sääntö tahdisti *jokaisen*
> pyynnön hitaimman ämpärin keskiarvoon. Tuntisääntö `200:3600` on keskimäärin yksi pyyntö per
> 18 sekuntia, joten kahdenkymmenen välilehden arkku kesti kuusi minuuttia — silloinkin kun
> tuntibudjetista oli käytetty 17/200. Budjetti oli olemassa, me vain kieltäydyimme käyttämästä
> sitä.
>
> Nyt väljä ämpäri ei vaadi mitään. Varannon jälkeen viive kiihtyy tasaisesti, joten katon
> lähestyminen on hidastus eikä seinä. Kovat suojat ovat ennallaan: tyhjä ämpäri odottaa yhä
> koko jaksonsa ja ilmoitettua rangaistusta noudatetaan sekunnilleen.
>
> Säädin on yksi luku, `PACING_RESERVE`. Se on tarkoituksella yksi: se vastaa kysymykseen
> "kuinka lähelle GGG:n kattoa tämä sovellus suostuu ajamaan".

Ensimmäinen kutsu palauttaa välilehtilistan **ja** ensimmäisen välilehden esineet samassa
vastauksessa, joten sitä ei lueta kahdesti.

---

## Hinnoittelu ja nimien selvitys

### poe.ninjan API vaihtui, ja se maksoi jotain

Vanha rajapinta `/api/data/currencyoverview` ja `/itemoverview` avaimitti jokaisen rivin
näyttönimellä. Se on poistettu: koko polku vastaa `not found` jokaiselle liigalle, myös
Standardille, koska osoite on vanhempi kuin poe.ninjan kahden pelin tuki eikä kerro kummasta on
kyse. Tilalla on yksi päätepiste peliä kohti:

```
https://poe.ninja/poe1/api/economy/exchange/current/overview?league=<liiga>&type=<tyyppi>
```

`league` on **GGG:n oma liiganimi sellaisenaan** — `Allflame`, `Hardcore Allflame`.

Rivillä ei ole enää nimeä, ikonia eikä uniikkien varianttikenttiä. Rivi on tunniste ja luku:

```json
{ "id": "alt", "primaryValue": 0.1238 }
```

Kolme seurausta, kaikki menetyksiä:

**Nimet** haetaan nyt toisin päin. Arkun esineen näyttönimestä lasketaan tunniste — ei tunnisteesta
nimeä, koska sitä suuntaa ei voi palauttaa: `assassins-favour` ei kerro mihin heittomerkki
kuului. Erittely näytetään edelleen näyttönimellä, ja se tulee arkusta, mikä on parempi lähde
kuin poe.ninja oli.

**Ikonit** eivät tule enää poe.ninjalta — se julkaisee ne vain chaosille ja divinelle. Ne
otetaan nyt **aarrearkun vastauksesta**, jossa jokaisella esineellä on `icon`-kenttä GGG:n omaan
CDN:ään. Se on parempi lähde kuin poe.ninja koskaan oli: se on juuri sen esineen kuva jota
lasketaan, piirtäjiltä itseltään. Kierros tallettaa näkemänsä hintasettiin, jota ikonihaku lukee
muutenkin, ja kirjoittaa vain kun jotain oli uutta.

**Uniikit** jäävät hinnoittelematta, ks. `PRICE_UNIQUE_CATEGORIES` yllä.

> **▸ Miksi tunnisteissa on kahta lajia ja mitä siitä seuraa:** uudemmat esineet käyttävät
> nimestä johdettua slugia (`accelerating-catalyst`, `awakeners-orb`), mutta vanhemmat valuutat
> käyttävät kauppapaikan lyhenteitä (`alt`, `alch`, `gcp`, `chaos`). Slugin tuottaa sääntö;
> lyhenteitä ei tuota mikään sääntö, joten ne ovat taulukossa `services/ninjaId.ts`.
>
> Taulukkoa **ei voi tarkistaa hintavastauksesta**, koska siinä ei ole nimiä. Siksi virhe on
> muotoiltu näkyväksi: puuttuva lyhenne tarkoittaa että nimi ei osu mihinkään ja esine päätyy
> "ei hintaa" -listaan — näkyvästi hinnoittelematta, ei hiljaa nollaksi. Kierros kirjaa lisäksi
> ne tunnisteet, joita mikään arkussa ei vastannut; juuri siltä puuttuva lyhenne näyttää.
> `verifyAliases` vertaa taulukkoa niihin kahteen nimeen jotka API vielä antaa.

### Näyttönimen valinta arkun esineestä

Arkun esineessä on `name`, `typeLine` ja `baseType`, ja se kumpi niistä on näyttönimi riippuu
esineen lajista:

| Laji | Näyttönimi |
|------|------------|
| Valuutta, sirpaleet, skarabit, essenssit | `baseType` (= `typeLine`) |
| Ennustuskortit | `typeLine` |
| Uniikit | `name` — `baseType` on pohja |

Uniikeilla kokeillaan `name` ensin, muuten `baseType`. Muuten Headhunter arvostettaisiin
nahkavyönä.

Nimien edessä on toisinaan GGG:n merkkaus `<<set:MS>><<set:M>><<set:S>>`; se kuoritaan pois.

**Jokainen hinnoittelematta jäänyt nimi kirjataan lokiin** joka kierroksella, määrineen. Ohitetut
kategoriat (jalokivet, kartat, klusterikorut, tunnistamattomat uniikit) lasketaan erikseen,
jotta tietoinen ohitus ei näytä samalta kuin puuttuva hinta.

> **▸ Miksi hiljainen nolla on pahin vaihtoehto:** esine jota ei osata hinnoitella painuu
> kokonaisarvossa nollaksi. Kaaviossa se näyttää siltä, ettei sitä ole. Loki on se paikka, josta
> aukon näkee — ja aukon näkeminen on ainoa tapa korjata se.

**Jos poe.ninja on nurin** eikä uutta hintasettiä saada, kierros jatkaa edellisellä setillä.
Tilannekuvan `priceSetAt` kertoo, kuinka vanhoilla hinnoilla se arvostettiin, ja
Tilannekuvat-taulukko näyttää sen sarakkeessa **PRICES**. Vasta jos yhtään settiä ei ole, kierros
kaatuu.
