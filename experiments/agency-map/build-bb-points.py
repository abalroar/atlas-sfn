import json,collections,math,hashlib,datetime
from pathlib import Path
p=Path(__file__).resolve().parent
bcb=json.loads((p/'agencies-current-source.json').read_text())['value']
bcb_bb=[r for r in bcb if r['CnpjBase']=='00000000']
bycode=collections.defaultdict(list)
for r in bcb_bb:
 c=r.get('CodigoCompe','')
 if c.isdigit():bycode[str(int(c))].append(r)
sources=[p/'open-finance-bb-branches-all.json',*sorted(p.glob('open-finance-bb-branches-page-*.json'))]
rows=[];metas=[];hashes={}
for f in sources:
 b=f.read_bytes();j=json.loads(b);hashes[f.name]=hashlib.sha256(b).hexdigest();metas.append(j.get('meta'));rows.extend(j.get('data',[]))
seen={}
for r in rows:seen[(r.get('identification',{}).get('type'),r.get('identification',{}).get('code'))]=r
agencies=[r for r in seen.values() if r.get('identification',{}).get('type')=='AGENCIA']
features=[];rejected=[]
for r in agencies:
 i=r['identification'];a=r['postalAddress'];code=i.get('code','');key=str(int(code)) if code.isdigit() else code;matches=bycode.get(key,[])
 try:
  g=a['geographicCoordinates'];lat=float(g['latitude']);lon=float(g['longitude'])
  valid=math.isfinite(lat) and math.isfinite(lon) and -34.0<=lat<=6.0 and -74.0<=lon<=-34.0
 except (KeyError,ValueError,TypeError):valid=False
 match=len(matches)==1 and str(a.get('ibgeCode'))==str(matches[0].get('MunicipioIbge'))
 if not valid or not match:
  rejected.append({'branchCode':code,'validCoordinate':valid,'bcbCodeMatches':len(matches),'bcbMunicipalityMatch':match,'city':a.get('townName')});continue
 b=matches[0]
 features.append({'type':'Feature','geometry':{'type':'Point','coordinates':[lon,lat]},'properties':{'bank':'Banco do Brasil','name':i.get('name'),'branchCode':code,'address':a.get('address'),'city':a.get('townName'),'ibgeCode':a.get('ibgeCode'),'uf':a.get('countrySubDivision'),'officialMatch':True,'coordinateMethod':'participant-supplied','matchMethod':'Banco do Brasil CnpjBase 00000000 + exact numeric agency COMPE code + equal IBGE municipality','source':'https://opendata.api.bb.com.br/open-banking/channels/v2/branches','registrySource':'https://olinda.bcb.gov.br/olinda/servico/Informes_Agencias/versao/v1/odata/Agencias','registryPosition':b.get('Posicao'),'branchCnpj':b['CnpjBase']+b['CnpjSequencial']+b['CnpjDv'],'bcbAddress':b.get('Endereco')}})
geo={'type':'FeatureCollection','name':'Banco do Brasil — agências com coordenadas informadas pelo participante e correspondência ao cadastro BCB','features':features}
(p/'bb-agencies.geojson').write_text(json.dumps(geo,ensure_ascii=False,separators=(',',':')))
counts=collections.Counter(f['properties']['uf'] for f in features);cities=collections.Counter(f['properties']['ibgeCode'] for f in features)
status=json.loads((p/'open-finance-bb-pagination-status.json').read_text()) if (p/'open-finance-bb-pagination-status.json').exists() else []
summary={'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'publicPrototypeOnly':True,'complete':False,'source':'https://opendata.api.bb.com.br/open-banking/channels/v2/branches','declaredTotalDependencies':8646,'declaredTotalPagesSize100':87,'observedMetaValues':metas,'rawRecordsCollected':len(rows),'uniqueDependenciesCollected':len(seen),'agenciesCollected':len(agencies),'agencyPointsExactMatch':len(features),'rejected':rejected,'pointsByState':dict(counts),'saoPauloCityPoints':cities['3550308'],'rioDeJaneiroCityPoints':cities['3304557'],'bcbAgencyUniverse':len(bcb_bb),'bcbAgencyPosition':'05/11/2026','bcbCoveragePct':round(len(features)/len(bcb_bb)*100,2),'failedOrPendingPages':status,'rawSha256':hashes,'warnings':['Current snapshot only; not a historical branch network.','Participant coordinates are supplied by Banco do Brasil, not independently surveyed.','Partial collection: coverage is explicit and points do not represent all Brazilian bank branches.','Open Finance participant CNPJ is matrix; join uses exact branch COMPE code and IBGE municipality.','Missing positions are not geocoded or replaced by municipal centroids.']}
(p/'bb-agencies-receipt.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print(json.dumps({k:summary[k] for k in ['rawRecordsCollected','agenciesCollected','agencyPointsExactMatch','pointsByState','saoPauloCityPoints','rioDeJaneiroCityPoints','bcbCoveragePct']},ensure_ascii=False))
print('Rejected',len(rejected),json.dumps(rejected[:5],ensure_ascii=False))
