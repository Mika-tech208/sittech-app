import json
hdia=1.6+1.6+(11+55/60-10.4)+ (14+20/60-13)+ (15+40/60-14-20/60)+(17-15-40/60)
hdia=sum([1.6,1.6,11+55/60-(10+24/60),80/60,80/60,80/60])
CH=31.9220; RAT=10.3442; MO=21.5779
# roteiros: metas por etapa (3 manha + 3 tarde)
def daily(m,t): return 3*0+ (m*(1.6+1.6+(11+55/60-(10+24/60)))/ (1.6+1.6+(11+55/60-(10+24/60))) if False else 0)
# soma diária das metas = 3m + 3t
R={
"Caixa Amarela 4x2":dict(p=0.217,et=[("Etiquetar",2500,2200,1608.4),("Montar Presilha",700,600,439.0)]),
"Pino":dict(p=0.07,et=[("Parafusar (Pino)",2000,1600,1375.5)]),
"Plug Macho":dict(p=0.099,et=[("Parafusar",1000,1000-0,702.5)]),
"Conector 3/4 CONV":dict(p=0.1825,et=[("Rosquear",2000,1600,1085.8),("Parafusar",1500,1200,893.7),("Etiquetar",3500,3000,2274.6),("Embalar",5000,4500,2781.4)]),
"Conector 3/4 AUTO":dict(p=0.182,et=[("Rosq+Paraf",1275,1100,693.3),("Etiquetar",3500,3000,2274.6),("Embalar",5000,4500,2781.4)]),
"Conector 1.1/4":dict(p=0.365,et=[("Rosquear",530,450,373.2),("Embalar",280,230,149.4)]),
}
# Plug: roteiro m=1000,t=1000? from query: m1..m3=1200 t=1000
R["Plug Macho"]["et"]=[("Parafusar",1200,1000,702.5)]
out={}
for k,v in R.items():
    p=v["p"]; hn=0; hr=0; rows=[]
    for (n,m,t,real) in v["et"]:
        nom=(3*m+3*t)/hdia
        hn+=1/nom; hr+=1/real
        rows.append((n,round(nom,1),real,round(p*nom,2),round(p*real,2)))
    out[k]=dict(p=p,etapas=rows,
      rev_h_cadeia_nom=round(p/hn,2), rev_h_cadeia_real=round(p/hr,2),
      custo_peca_nom=round(hn*CH,5), custo_peca_real=round(hr*CH,5),
      mo_peca_nom=round(hn*MO,5), mo_peca_real=round(hr*MO,5),
      horas_op_mil_nom=round(hn*1000,3), horas_op_mil_real=round(hr*1000,3),
      margem_sistema_peca_nom=round(p-hn*CH,5), margem_pct_nom=round((p-hn*CH)/p*100,1),
      lucro_h_sistema_nom=round((p-hn*CH)/hn,2),
      margem_sistema_real_pct=round((p-hr*CH)/p*100,1), lucro_h_sistema_real=round((p-hr*CH)/hr,2))
print("hdia",hdia)
for k,v in out.items():
    print(k); 
    for kk,vv in v.items(): print("  ",kk,vv)
json.dump(out,open("calc.json","w"),indent=1)
