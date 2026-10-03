# Checklist de preclase

Hazlo el mismo día, con el portátil que vas a proyectar. No hace falta repetir `bun run test` si el código no ha cambiado desde la fase 7.

## Común a S10 y S11

1. Directorio: `/Users/jose/Documents/the-power/3-rag`.
2. `bun run preflight`. Código 0. Debe decir `APP_MODE efectivo: demo`, sin RAG `offline-demo`, RAG y CRAG `offline-fixture`, `verificado remotamente: no`.
3. `bun run dev`. Espera la línea `Local:` y abre esa URL. En el ensayo del 3 de octubre fue `http://localhost:5173/`.
4. Si preflight no dice `APP_MODE efectivo: demo`, no empieces. Sigue `incidencias-y-respaldo.md`. Un reinicio sin variables de proceso no pisa `.dev.vars`. No uses `activate` para corregirlo.
5. Banner visible: `Perfil: demo (fixture)`, corpus `c3a59a406888b`, embedding `fixture-token-hash-v1`, remoto no verificado.
6. Presentación de la clase abierta en el modo presentación, diapositiva 1.
7. Carpeta `material/evidencias/capturas/` abierta en el Finder.
8. QR de respaldo: `material/assets/qr-ai-engineer.jpg`.
9. No exportes `CLOUDFLARE_API_TOKEN` ni pongas `APP_MODE` en `real` para la clase.
10. No ejecutes `bun run activate -- status --read` ni ningún `--execute`.

## Solo S10

- Enunciado `material/ejercicios/S10-enunciado.md`.
- `corpus/COVERAGE.md` y `corpus/fixtures/fragmento-sintetico.json` localizados. El JSON se lee. No se ingiere.
- Una pregunta de sin RAG, una de RAG, el rechazo de 1991 y la fecha M/J de S10, en ese orden, como ensayo de cinco minutos. Los textos esperados están en el guion.

## Solo S11

- Enunciado `material/ejercicios/S11-enunciado.md`.
- Desplegable de guion visible al elegir CRAG.
- Recorre, sin leer en voz alta todo el fragmento: suficiente, parcial, descarte, ausente, calendario y error. Audiencia General.
- Una pregunta libre corta, con el desplegable en «Libre».

## Al terminar la clase

Cierra el servidor de `bun run dev` en la terminal donde quedó. No dejes un `activate --execute` a medias. No hay nada que desplegar.
