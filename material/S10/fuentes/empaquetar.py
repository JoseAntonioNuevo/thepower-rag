# GUÍA DE LECTURA · material/S10/fuentes/empaquetar.py
# Actualiza los tres paquetes existentes; excluye secretos, estado local y artefactos privados de QA.
# Path mantiene las rutas portables; hashlib permite identificar los ZIP y stat conserva los enlaces simbólicos.
from pathlib import Path
import hashlib,json,stat,zipfile
# Ancla el empaquetado al repositorio de estas fuentes, sin depender del directorio de la terminal.
root=Path(__file__).resolve().parents[3]
# Localiza los tres paquetes docentes que deben actualizarse juntos.
material=root/'material'
# Decide si un archivo se puede distribuir: excluye secretos, estado privado y paquetes anidados.
def safe(p):
 # Examina cada componente de la ruta relativa, incluidos directorios internos del repositorio.
 parts=p.relative_to(root).parts
 # Descarta dependencias, repositorio Git, recibos privados y directorios temporales en cualquier nivel.
 if any(x in {'.git','.local','.build','.wrangler','.tgrep','.vp','node_modules','activation-receipts','resultados'} for x in parts):return False
 # Evita introducir otro ZIP o permisos locales de activación en los paquetes distribuidos.
 if p.suffix=='.zip' or p.name=='.activation.json':return False
 # Permite las plantillas .example y excluye los archivos de entorno con valores reales.
 if p.name.startswith(('.env','.dev.vars')) and not p.name.endswith('.example'):return False
 # Solo admite archivos existentes; los directorios no se añaden como contenido independiente.
 return p.is_file()
# Escribe un ZIP temporal, conserva los enlaces y valida el archivo antes de devolver su huella.
def write_zip(target,entries):
 # Prepara una ruta temporal para no ir modificando directamente el paquete de destino.
 temp=target.with_suffix('.tmp.zip')
 # Abre el contenedor con compresión DEFLATE y cierra sus descriptores al salir del bloque.
 with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  # Ordena las entradas por nombre para conservar una secuencia estable en el paquete.
  for name,p in sorted(entries.items()):
   # Aplica el filtro de distribución incluso a las rutas heredadas del ZIP anterior.
   if not safe(p):continue
   # Un enlace simbólico debe conservar su destino relativo, no convertirse en una copia del archivo enlazado.
   if p.is_symlink():
    # Marca la entrada como enlace Unix y guarda su destino textual, por ejemplo CLAUDE.md → AGENTS.md.
    info=zipfile.ZipInfo(name);info.create_system=3;info.external_attr=(stat.S_IFLNK|0o755)<<16;z.writestr(info,p.readlink().as_posix())
   # Los archivos normales conservan sus bytes y se guardan bajo la ruta lógica de la entrada.
   else:z.write(p,name)
 # Reemplaza el ZIP de destino cuando la escritura temporal ya ha terminado.
 temp.replace(target)
 # Vuelve a abrir el resultado para comprobar su integridad y las exclusiones de privacidad.
 with zipfile.ZipFile(target) as z:
  # Verifica el CRC de todas las entradas, no solo que el contenedor pueda abrirse.
  assert z.testzip() is None
  # Inspecciona cada nombre del archivo distribuido tras la escritura.
  for name in z.namelist():
   # Comprueba que no se haya incluido estado privado ni dependencias del entorno de construcción.
   assert not any(x in name.split('/') for x in ['.build','.local','node_modules','.wrangler'])
   # Exige que cualquier archivo de entorno distribuido sea una plantilla de ejemplo.
   assert not (Path(name).name.startswith(('.env','.dev.vars')) and not name.endswith('.example'))
 # Entrega nombre, número de entradas previstas y SHA-256 de los bytes finales del ZIP.
 return {'file':target.name,'entries':len(entries),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
# Conserva las rutas previamente distribuidas para no perder material de S11.
with zipfile.ZipFile(material/'S10-S11-demo-codigo.zip') as z:oldcode=z.namelist()
# Mantiene el mapa de rutas anterior y resuelve el LEEME del código a su fuente canónica.
code={n:(material/'demo-codigo-LEEME.md' if n=='LEEME.md' else root/n) for n in oldcode if not n.endswith('/')}
# Añade también los archivos nuevos del laboratorio, scripts y adaptadores de la API.
for folder in ['lab','scripts','apps/api/src']:
 # Recorre los subdirectorios para incluir sus fuentes con la misma ruta relativa.
 for p in (root/folder).rglob('*'):
  # Actualiza cada entrada permitida con el archivo actual del repositorio.
  if safe(p):code[p.relative_to(root).as_posix()]=p
# Incluye las guías y enunciados canónicos que acompañan la práctica de S10.
for name in ['material/ejercicios/laboratorio-apoyo.md','material/ejercicios/laboratorio-apoyo.pdf','material/ejercicios/S10-enunciado.md','material/ejercicios/S10-enunciado.pdf']:
 # Asocia cada ruta docente a su archivo actual, sin generar de nuevo los PDF.
 code[name]=root/name
# Lee las rutas del paquete anterior del profesor para conservar también el material de S11.
with zipfile.ZipFile(material/'S10-S11-profesor.zip') as z:oldteacher=z.namelist()
# Resuelve las rutas heredadas contra el repositorio que se está preparando.
teacher={n:root/n for n in oldteacher if not n.endswith('/')}
# Incorpora fuentes, evidencias y laboratorio de S10 disponibles en este ensayo.
for folder in ['material/S10','lab']:
 # Recorre sus archivos para añadir también las nuevas fuentes docentes.
 for p in (root/folder).rglob('*'):
  # Solo añade archivos que superan el mismo filtro de privacidad que el código.
  if safe(p):teacher[p.relative_to(root).as_posix()]=p
# Actualiza explícitamente guion, presentación, QR y guías que usará el profesor en clase.
for name in ['material/README.md','material/guiones/S10-guion-profesor.md','material/guiones/S10-guion-profesor.pdf','material/presentaciones/S10-rag-basico.pptx','material/presentaciones/S10-rag-basico.pdf','material/assets/qr-ai-engineer.jpg','material/assets/qr-origen.md','material/ejercicios/laboratorio-apoyo.md','material/ejercicios/laboratorio-apoyo.pdf','material/notas/checklist-preclase.md','material/notas/checklist-preclase.pdf']:
 # Relaciona cada entrada del paquete del profesor con su fuente canónica actual.
 teacher[name]=root/name
# El paquete del alumno empieza con sus instrucciones de entrega bajo el nombre LEEME.md.
student={'LEEME.md':material/'alumno-LEEME.md'}
# Añade los enunciados y la guía de apoyo de S10/S11 en sus dos formatos de lectura.
for name in ['S10-enunciado.md','S10-enunciado.pdf','S11-enunciado.md','S11-enunciado.pdf','laboratorio-apoyo.md','laboratorio-apoyo.pdf']:student[name]=material/'ejercicios'/name
# Distribuye el QR y su procedencia en el subdirectorio de recursos del alumno.
for name in ['qr-origen.md','qr-ai-engineer.jpg']:student['assets/'+name]=material/'assets'/name
# Regenera los tres destinos con sus mapas y recoge los recibos de cada archivo final.
results=[write_zip(material/'S10-S11-demo-codigo.zip',code),write_zip(material/'S10-S11-profesor.zip',teacher),write_zip(material/'S10-S11-alumno.zip',student)]
# Guarda las huellas del empaquetado en el área privada de construcción.
(root/'material/S10/.build/paquetes.json').write_text(json.dumps(results,indent=2)+'\n')
# Imprime los recibos para que el profesor pueda contrastar nombres y hashes.
print(json.dumps(results,indent=2))
