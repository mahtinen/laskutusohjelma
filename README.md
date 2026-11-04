# Laskutusohjelma

Ilmainen selainpohjainen laskugeneraattori (vrt. ilmainenlaskutusohjelma.fi/invoice). Ei vaadi asennusta, palvelinta eikä riippuvuuksia — avaa `index.html` selaimessa.

## Käyttö

1. Avaa `index.html` selaimessa (tuplaklikkaus riittää).
2. Täytä laskuttajan, vastaanottajan ja laskun tiedot sekä laskurivit. Esikatselu oikealla päivittyy reaaliajassa.
3. Paina **Tulosta / tallenna PDF** — selaimen tulostusikkunasta voi tulostaa paperille tai tallentaa PDF:nä.

## Ominaisuudet (MVP)

- Laskuttajan, vastaanottajan ja laskun tiedot samalla kenttävalikoimalla kuin alkuperäisessä
- Laskurivit: nimike, määrä, yksikkö, veroton á-hinta, ALV-kanta (25,5 / 14 / 10 / 0 %)
- Automaattinen laskenta: rivikohtainen veroton, ALV ja yhteensä; ALV-erittely kannoittain; loppusumma (laskenta sentteinä, ei liukulukuvirheitä)
- Tulostettava A4-lasku selaimen tulostustoiminnolla

## Parannukset alkuperäiseen verrattuna

- **Oma logo** — lataa PNG-, JPEG-, WebP- tai SVG-kuva, joka tulostuu laskun ylälaitaan; kuva pienennetään selaimessa ja tallentuu selaimeen omien tietojen mukana (ei lähetetä mihinkään)
- **Pankkiviivakoodi** (Finanssialan pankkiviivakoodi, versio 4, Code 128 C) tulostuu laskun alalaitaan, kun laskulla on kelvollinen suomalainen IBAN ja viitenumero — laskun voi maksaa lukemalla koodin pankkisovelluksella
- **Reaaliaikainen esikatselu** — lomake vasemmalla, valmis lasku oikealla
- **Viitenumeron automaattinen muodostus** laskun numerosta tarkistenumeroineen (painot 7-3-1) sekä käsin syötetyn viitteen tarkisteen validointi
- **IBAN-validointi** (mod 97) ja **BIC:n automaattinen tunnistus** suomalaisesta tilinumerosta
- **Eräpäivän automaattinen laskenta** maksuehdosta
- **ALV-tunnisteen automaattinen muodostus** Y-tunnuksesta
- **Asiakasrekisteri** — tallenna asiakkaan tiedot nimellä ja hae ne pudotusvalikosta seuraavaa laskua varten; tallennus "Tallenna asiakas" -napilla, samanniminen tallennus päivittää aiemmat tiedot
- **Varmuuskopiointi** — "Vie varmuuskopio" lataa kaikki tiedot (omat tiedot, logo, asiakasrekisteri, avoin lasku) JSON-tiedostona koneelle; "Tuo varmuuskopio" palauttaa ne samaan tai toiseen selaimeen/koneeseen
- **Tietojen tallennus selaimeen** (localStorage) — omat tiedot säilyvät seuraavaan laskuun; "Uusi lasku" tyhjentää asiakkaan ja rivit, kasvattaa laskun numeroa ja säilyttää omat tiedot

## Tiedostot

- `index.html` — lomake ja laskun esikatselurakenne
- `style.css` — käyttöliittymän ja tulostuksen (A4 print CSS) tyylit
- `app.js` — laskenta, viite/IBAN/viivakoodilogiikka ja käyttöliittymän sidonta

## Huomioita

- Kaikki tiedot pysyvät omalla koneella — mitään ei lähetetä minnekään.
- Pankkiviivakoodin summakenttä koodataan nollina, jos summa on 0 € tai yli 999 999,99 € (spesifikaation mukaisesti).
- Viivakoodilogiikka on testattu Finanssialan pankkiviivakoodioppaan esimerkkiä vasten.
