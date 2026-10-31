from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import subprocess, zipfile
root=Path(__file__).resolve().parents[1]
tools=root/'.android-tools'
tools.mkdir(exist_ok=True)
jobs=[('build-tools.zip','https://dl.google.com/android/repository/build-tools_r35_linux.zip','build-tools'),('platform.zip','https://dl.google.com/android/repository/platform-35_r02.zip','platform'),('ecj.jar','https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/3.41.0/ecj-3.41.0.jar',None)]
def get(job):
 name,url,dest=job;file=tools/name
 if not file.exists():
  subprocess.run(['curl','--fail','--location','--retry','2','--connect-timeout','20','--max-time','240','--silent','--show-error',url,'-o',str(file)+'.part'],check=True)
  Path(str(file)+'.part').replace(file)
 if dest:
  with zipfile.ZipFile(file) as z:z.extractall(tools/dest)
 return name
with ThreadPoolExecutor(max_workers=4) as pool:
 futures=[pool.submit(get,j) for j in jobs]
 futures.append(pool.submit(subprocess.run,['npm','install','--cache','/tmp/mediflow-npm-cache','--prefer-offline','--no-audit','--no-fund','--fetch-retries=0','--fetch-timeout=45000'],cwd=root,check=True))
 for f in as_completed(futures):
  result=f.result();print('Ready:',result if isinstance(result,str) else 'app dependencies',flush=True)
