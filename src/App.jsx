import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

/* ══════════════════════════════════════════════════════════════
   TOKENIZER
══════════════════════════════════════════════════════════════ */
const SQL_KW = new Set("SELECT FROM WHERE AND OR NOT IN LIKE IS NULL BETWEEN EXISTS INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE DROP ALTER ADD COLUMN JOIN LEFT RIGHT INNER OUTER FULL CROSS ON AS GROUP BY ORDER HAVING LIMIT OFFSET DISTINCT UNION ALL INTERSECT EXCEPT CASE WHEN THEN ELSE END PRIMARY KEY FOREIGN REFERENCES UNIQUE DEFAULT CHECK INDEX VIEW ASC DESC IF RECURSIVE WITH TRUE FALSE INT INTEGER BIGINT SMALLINT FLOAT DOUBLE DECIMAL NUMERIC VARCHAR CHAR TEXT BLOB BOOLEAN BOOL DATE TIME DATETIME TIMESTAMP REAL SERIAL AUTO_INCREMENT".split(" "));
const SQL_FN = new Set("COUNT SUM AVG MIN MAX UPPER LOWER LENGTH SUBSTR SUBSTRING TRIM LTRIM RTRIM REPLACE CONCAT COALESCE NULLIF CAST ROUND FLOOR CEIL ABS SQRT NOW YEAR MONTH DAY ISNULL NVL".split(" "));

function tokenize(input) {
  const toks = []; let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { let j=i; while(j<input.length&&/\s/.test(input[j]))j++; toks.push({t:'ws',v:input.slice(i,j),s:i}); i=j; continue; }
    if (ch==='-'&&input[i+1]==='-') { let j=i; while(j<input.length&&input[j]!=='\n')j++; toks.push({t:'comment',v:input.slice(i,j),s:i}); i=j; continue; }
    if (ch==='/'&&input[i+1]==='*') { let j=i+2; while(j<input.length&&!(input[j]==='*'&&input[j+1]==='/'))j++; toks.push({t:'comment',v:input.slice(i,j+2),s:i}); i=j+2; continue; }
    if (ch==="'"||ch==='"') { let q=ch,j=i+1; while(j<input.length&&input[j]!==q)j++; toks.push({t:'string',v:input.slice(i,j+1),s:i}); i=j+1; continue; }
    if (ch==='`') { let j=i+1; while(j<input.length&&input[j]!=='`')j++; toks.push({t:'ident',v:input.slice(i+1,j),s:i}); i=j+1; continue; }
    if (/\d/.test(ch)||(ch==='.'&&/\d/.test(input[i+1]||''))) { let j=i; while(j<input.length&&/[\d.]/.test(input[j]))j++; toks.push({t:'number',v:input.slice(i,j),s:i}); i=j; continue; }
    if (/[a-zA-Z_]/.test(ch)) { let j=i; while(j<input.length&&/\w/.test(input[j]))j++; const w=input.slice(i,j),u=w.toUpperCase(); toks.push({t:SQL_KW.has(u)?'kw':SQL_FN.has(u)?'fn':'ident',v:w,s:i}); i=j; continue; }
    const two=input.slice(i,i+2);
    if(['<=','>=','!=','<>','||'].includes(two)){toks.push({t:'op',v:two,s:i});i+=2;continue;}
    if(/[=<>+\-*\/!%]/.test(ch)){toks.push({t:'op',v:ch,s:i});i++;continue;}
    toks.push({t:/[(),;.\[\]]/.test(ch)?'punct':'unknown',v:ch,s:i}); i++;
  }
  return toks;
}

/* ══════════════════════════════════════════════════════════════
   SYNTAX HIGHLIGHTER
══════════════════════════════════════════════════════════════ */
const HL = {kw:'#569CD6',fn:'#DCDCAA',string:'#CE9178',number:'#B5CEA8',comment:'#6A9955',op:'#C9D1D9',ident:'#9CDCFE',punct:'#6E7681'};
function highlight(sql) {
  return tokenize(sql).map(tok => {
    const e=tok.v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const c=HL[tok.t]; return(c&&tok.t!=='ws')?`<span style="color:${c}">${e}</span>`:e;
  }).join('');
}

/* ══════════════════════════════════════════════════════════════
   SQL PARSER
══════════════════════════════════════════════════════════════ */
const FOLLOW = new Set("FROM WHERE ORDER GROUP HAVING LIMIT JOIN LEFT RIGHT INNER OUTER FULL CROSS UNION INTERSECT EXCEPT INTO ON SET".split(" "));

class SQLParser {
  constructor(toks){this.toks=toks.filter(t=>t.t!=='ws'&&t.t!=='comment');this.p=0;}
  peek(o=0){return this.toks[this.p+o];}
  next(){return this.toks[this.p++];}
  uv(o=0){return(this.toks[this.p+o]?.v||'').toUpperCase();}
  try_(v){if(this.uv()===v.toUpperCase()){this.p++;return true;}return false;}
  expect(v){if(this.uv()!==v.toUpperCase())throw new Error(`Expected '${v}', got '${this.peek()?.v||'<end>'}'`);return this.next();}

  stmt(){
    switch(this.uv()){
      case 'SELECT':return this.select();case 'CREATE':return this.create();
      case 'INSERT':return this.insert();case 'DROP':return this.drop_();
      case 'DELETE':return this.delete_();case 'UPDATE':return this.update_();
      default:throw new Error(`Unknown statement: '${this.peek()?.v||'<empty>'}'`);
    }
  }

  select(){
    this.expect('SELECT');const distinct=this.try_('DISTINCT');const cols=[];
    do {
      if(this.uv()==='*'){this.next();cols.push({k:'star'});continue;}
      const expr=this.expr();let alias=null;
      if(this.try_('AS'))alias=this.next().v;
      else if(this.peek()?.t==='ident'&&!FOLLOW.has(this.uv()))alias=this.next().v;
      cols.push({k:'e',expr,alias});
    } while(this.try_(','));
    let from=null;if(this.try_('FROM'))from=this.tref();
    const joins=[];
    while(true){
      let jt=null;
      if(this.uv()==='JOIN'){this.next();jt='INNER';}
      else if(['LEFT','RIGHT','INNER','OUTER','FULL','CROSS'].includes(this.uv())){
        jt=this.next().v.toUpperCase();
        if(['OUTER','INNER'].includes(this.uv()))this.next();
        if(this.uv()!=='JOIN'){this.p--;break;}this.next();
      }else break;
      const t=this.tref();this.expect('ON');const c=this.expr();joins.push({jt,t,c});
    }
    let where=null;if(this.try_('WHERE'))where=this.expr();
    let groupBy=null;if(this.uv()==='GROUP'){this.next();this.expect('BY');groupBy=[];do{groupBy.push(this.expr());}while(this.try_(','));}
    let having=null;if(this.try_('HAVING'))having=this.expr();
    let orderBy=null;
    if(this.uv()==='ORDER'){this.next();this.expect('BY');orderBy=[];
      do{const e=this.expr();const d=this.uv()==='DESC'?(this.next(),'DESC'):this.try_('ASC')?'ASC':'ASC';orderBy.push({e,d});}while(this.try_(','));}
    let limit=null,offset=null;
    if(this.try_('LIMIT')){limit=+this.next().v;if(this.try_('OFFSET'))offset=+this.next().v;}
    return{T:'SELECT',distinct,cols,from,joins,where,groupBy,having,orderBy,limit,offset};
  }

  tref(){
    const name=this.next().v;let alias=null;
    if(this.try_('AS'))alias=this.next().v;
    else if(this.peek()?.t==='ident'&&!FOLLOW.has(this.uv())&&this.uv()!=='ON')alias=this.next().v;
    return{name,alias:alias||name};
  }

  expr(prec=0){
    let left=this.primary();
    while(true){
      if(this.uv()==='NOT'&&['IN','LIKE','BETWEEN'].includes(this.uv(1))){
        this.next();const op=this.uv();this.next();
        if(op==='IN'){this.expect('(');const v=[];if(this.uv()!==')')do{v.push(this.primary());}while(this.try_(','));this.expect(')');left={T:'not_in',left,v};}
        else if(op==='LIKE'){left={T:'not_like',left,pat:this.primary()};}
        else{const lo=this.primary();this.expect('AND');const hi=this.primary();left={T:'nbetween',left,lo,hi};}
        continue;
      }
      const op=this.bop();if(!op||op.p<prec)break;this.next();
      if(op.v==='IS'){const not=this.try_('NOT');this.expect('NULL');left={T:'is_null',e:left,not};}
      else if(op.v==='IN'){this.expect('(');const v=[];if(this.uv()!==')')do{v.push(this.primary());}while(this.try_(','));this.expect(')');left={T:'in',left,v};}
      else if(op.v==='LIKE'){left={T:'like',left,pat:this.primary()};}
      else if(op.v==='BETWEEN'){const lo=this.primary();this.expect('AND');const hi=this.primary();left={T:'between',left,lo,hi};}
      else left={T:'binop',op:op.v,left,right:this.expr(op.p+1)};
    }
    return left;
  }

  bop(){
    const v=this.uv();
    return({'OR':{v:'OR',p:1},'AND':{v:'AND',p:2},'=':{v:'=',p:4},'!=':{v:'!=',p:4},'<>':{v:'!=',p:4},'<':{v:'<',p:4},'>':{v:'>',p:4},'<=':{v:'<=',p:4},'>=':{v:'>=',p:4},'IS':{v:'IS',p:4},'IN':{v:'IN',p:4},'LIKE':{v:'LIKE',p:4},'BETWEEN':{v:'BETWEEN',p:4},'+':{v:'+',p:5},'-':{v:'-',p:5},'*':{v:'*',p:6},'/':{v:'/',p:6},'%':{v:'%',p:6},'||':{v:'||',p:5}})[v]||null;
  }

  primary(){
    const t=this.peek();if(!t)throw new Error('Unexpected end of expression');
    const v=t.v,u=v.toUpperCase();
    if(v==='('){this.next();const e=this.expr();this.expect(')');return e;}
    if(u==='NOT'){this.next();return{T:'not',e:this.primary()};}
    if(v==='-'){this.next();return{T:'neg',e:this.primary()};}
    if(t.t==='string'){this.next();return{T:'lit',val:v.slice(1,-1)};}
    if(t.t==='number'){this.next();return{T:'lit',val:parseFloat(v)};}
    if(u==='NULL'){this.next();return{T:'lit',val:null};}
    if(u==='TRUE'){this.next();return{T:'lit',val:true};}
    if(u==='FALSE'){this.next();return{T:'lit',val:false};}
    if(u==='CASE')return this.case_();
    if(['kw','fn','ident'].includes(t.t)){
      this.next();
      if(this.peek()?.v==='('){
        this.next();let args=[],star=false;
        if(this.peek()?.v==='*'){this.next();star=true;}
        else if(this.uv()!==')'){this.try_('DISTINCT');do{args.push(this.expr());}while(this.try_(','));}
        this.expect(')');return{T:'call',fn:u,args,star};
      }
      if(this.peek()?.v==='.'){this.next();if(this.peek()?.v==='*'){this.next();return{T:'tstar',tbl:v};}return{T:'col',tbl:v,col:this.next().v};}
      return{T:'col',tbl:null,col:v};
    }
    if(v==='*'){this.next();return{T:'star'};}
    throw new Error(`Unexpected token: '${v}'`);
  }

  case_(){
    this.expect('CASE');const branches=[];
    while(this.uv()==='WHEN'){this.next();const when=this.expr();this.expect('THEN');const then=this.expr();branches.push({when,then});}
    let els=null;if(this.try_('ELSE'))els=this.expr();
    this.expect('END');return{T:'case',branches,els};
  }

  create(){
    this.expect('CREATE');this.expect('TABLE');this.try_('IF');this.try_('NOT');this.try_('EXISTS');
    const name=this.next().v;this.expect('(');const cols=[];
    do{
      if(['PRIMARY','FOREIGN','UNIQUE','CHECK','INDEX','CONSTRAINT'].includes(this.uv())){while(this.peek()&&this.uv()!==','&&this.uv()!==')')this.next();continue;}
      const cname=this.next().v;const ctype=this.next().v;
      if(this.peek()?.v==='('){this.next();while(this.uv()!==')')this.next();this.next();}
      while(this.peek()&&this.uv()!==','&&this.uv()!==')')this.next();
      cols.push({name:cname,type:ctype});
    }while(this.try_(','));
    this.expect(')');return{T:'CREATE',name,cols};
  }

  insert(){
    this.expect('INSERT');this.expect('INTO');const name=this.next().v;let cols=null;
    if(this.peek()?.v==='('){this.next();cols=[];do{cols.push(this.next().v);}while(this.try_(','));this.expect(')');}
    this.expect('VALUES');const rows=[];
    do{this.expect('(');const v=[];if(this.uv()!==')')do{v.push(this.primary());}while(this.try_(','));this.expect(')');rows.push(v);}while(this.try_(','));
    return{T:'INSERT',name,cols,rows};
  }

  drop_(){this.expect('DROP');this.expect('TABLE');this.try_('IF');this.try_('EXISTS');return{T:'DROP',name:this.next().v};}

  delete_(){
    this.expect('DELETE');this.expect('FROM');const name=this.next().v;
    let where=null;if(this.try_('WHERE'))where=this.expr();
    return{T:'DELETE',name,where};
  }

  update_(){
    this.expect('UPDATE');const name=this.next().v;this.expect('SET');const sets=[];
    do{const col=this.next().v;this.expect('=');const val=this.expr();sets.push({col,val});}while(this.try_(','));
    let where=null;if(this.try_('WHERE'))where=this.expr();
    return{T:'UPDATE',name,sets,where};
  }
}

/* ══════════════════════════════════════════════════════════════
   DATABASE ENGINE
══════════════════════════════════════════════════════════════ */
class Database {
  constructor(){this.tables={};this.seed();}
  seed(){
    this.tables={
      departments:{cols:['id','name','location'],rows:[[1,'Engineering','Floor 3'],[2,'Marketing','Floor 2'],[3,'Finance','Floor 1'],[4,'HR','Floor 2'],[5,'Operations','Floor 4']]},
      employees:{cols:['id','name','department_id','salary','hire_date'],rows:[[1,'Alice Chen',1,95000,'2020-03-15'],[2,'Bob Smith',2,72000,'2019-07-22'],[3,'Carol White',1,110000,'2018-01-10'],[4,'David Kim',3,88000,'2021-05-30'],[5,'Eva Martinez',4,65000,'2022-02-14'],[6,'Frank Johnson',1,102000,'2017-09-01'],[7,'Grace Lee',2,78000,'2020-11-18'],[8,'Henry Wilson',5,91000,'2019-03-25'],[9,'Iris Brown',3,85000,'2021-08-12'],[10,'Jake Davis',1,98000,'2020-06-07']]},
      products:{cols:['id','name','category','price','stock'],rows:[[1,'Laptop Pro','Electronics',1299.99,45],[2,'Wireless Mouse','Electronics',29.99,200],[3,'Office Chair','Furniture',349.99,30],[4,'Standing Desk','Furniture',599.99,15],[5,'Notebook Pack','Stationery',12.99,500],[6,'Pen Set','Stationery',8.99,800],[7,'Monitor 4K','Electronics',449.99,60],[8,'Headphones','Electronics',199.99,90],[9,'Bookshelf','Furniture',229.99,20],[10,'Whiteboard','Office',89.99,40]]},
      orders:{cols:['id','product_id','quantity','total','order_date'],rows:[[1,1,2,2599.98,'2024-01-15'],[2,3,1,349.99,'2024-01-20'],[3,2,5,149.95,'2024-02-01'],[4,7,1,449.99,'2024-02-14'],[5,5,10,129.90,'2024-02-28'],[6,8,3,599.97,'2024-03-10'],[7,1,1,1299.99,'2024-03-15'],[8,4,2,1199.98,'2024-03-20'],[9,6,20,179.80,'2024-04-01'],[10,7,2,899.98,'2024-04-10']]}
    };
  }

  run(sql){
    return sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>{
      const ast=new SQLParser(tokenize(s)).stmt();return this.exec(ast);
    });
  }

  exec(ast){
    switch(ast.T){
      case 'SELECT':return this.select(ast);case 'CREATE':return this.create(ast);
      case 'INSERT':return this.insert(ast);case 'DROP':return this.drop(ast);
      case 'DELETE':return this.del(ast);case 'UPDATE':return this.upd(ast);
      default:throw new Error(`Unknown: ${ast.T}`);
    }
  }

  _tbl(n){const t=this.tables[n.toLowerCase()];if(!t)throw new Error(`Table '${n}' not found. Tables: ${Object.keys(this.tables).join(', ')}`);return t;}
  _obj(tbl,alias,row){const o={};tbl.cols.forEach((c,i)=>o[`${alias}.${c}`]=row[i]);return o;}
  _col(row,tbl,col){
    const cl=col.toLowerCase();
    if(tbl){for(const k of Object.keys(row)){if(k.toLowerCase()===`${tbl.toLowerCase()}.${cl}`)return row[k];}return null;}
    for(const k of Object.keys(row)){const p=k.split('.');if(p[p.length-1].toLowerCase()===cl)return row[k];}
    return null;
  }

  ev(x,row,grp=null){
    if(!x)return null;
    switch(x.T){
      case 'lit':return x.val;
      case 'col':return this._col(row,x.tbl,x.col);
      case 'star':case 'tstar':return null;
      case 'not':return!this.ev(x.e,row,grp);
      case 'neg':return-(+this.ev(x.e,row,grp)||0);
      case 'is_null':{const v=this.ev(x.e,row,grp),n=v==null;return x.not?!n:n;}
      case 'in':{const lv=this.ev(x.left,row,grp);return x.v.some(v=>this.ev(v,row,grp)==lv);}
      case 'not_in':{const lv=this.ev(x.left,row,grp);return!x.v.some(v=>this.ev(v,row,grp)==lv);}
      case 'like':{const s=String(this.ev(x.left,row,grp)??''),p=String(this.ev(x.pat,row,grp)??'');return new RegExp('^'+p.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*').replace(/_/g,'.')+'$','i').test(s);}
      case 'not_like':{const s=String(this.ev(x.left,row,grp)??''),p=String(this.ev(x.pat,row,grp)??'');return!new RegExp('^'+p.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*').replace(/_/g,'.')+'$','i').test(s);}
      case 'between':{const v=this.ev(x.left,row,grp);return v>=this.ev(x.lo,row,grp)&&v<=this.ev(x.hi,row,grp);}
      case 'nbetween':{const v=this.ev(x.left,row,grp);return v<this.ev(x.lo,row,grp)||v>this.ev(x.hi,row,grp);}
      case 'case':{for(const{when,then}of x.branches)if(this.ev(when,row,grp))return this.ev(then,row,grp);return x.els?this.ev(x.els,row,grp):null;}
      case 'binop':{
        const l=this.ev(x.left,row,grp),r=this.ev(x.right,row,grp);
        switch(x.op){
          case '=':return l==r;case '!=':return l!=r;case '<':return l<r;case '>':return l>r;case '<=':return l<=r;case '>=':return l>=r;
          case 'AND':return!!l&&!!r;case 'OR':return!!l||!!r;
          case '+':return(+l||0)+(+r||0);case '-':return(+l||0)-(+r||0);case '*':return(+l||0)*(+r||0);case '/':return+r?((+l||0)/(+r)):null;case '%':return(+l||0)%(+r||0);
          case '||':return`${l??''}${r??''}`;default:return null;
        }
      }
      case 'call':{
        const fn=x.fn,rows=grp||[row],g=(r)=>this.ev(x.args[0],r,null);
        switch(fn){
          case 'COUNT':return x.star?rows.length:rows.filter(r=>g(r)!=null).length;
          case 'SUM':return rows.reduce((a,r)=>a+(+g(r)||0),0);
          case 'AVG':{const vs=rows.map(r=>+g(r)).filter(v=>!isNaN(v));return vs.length?vs.reduce((a,b)=>a+b,0)/vs.length:null;}
          case 'MIN':{const vs=rows.map(r=>g(r)).filter(v=>v!=null);return vs.length?vs.reduce((a,b)=>a<b?a:b):null;}
          case 'MAX':{const vs=rows.map(r=>g(r)).filter(v=>v!=null);return vs.length?vs.reduce((a,b)=>a>b?a:b):null;}
          case 'UPPER':return String(this.ev(x.args[0],row,grp)??'').toUpperCase();
          case 'LOWER':return String(this.ev(x.args[0],row,grp)??'').toLowerCase();
          case 'LENGTH':return String(this.ev(x.args[0],row,grp)??'').length;
          case 'TRIM':return String(this.ev(x.args[0],row,grp)??'').trim();
          case 'ROUND':{const v=+this.ev(x.args[0],row,grp)||0;const d=x.args[1]?+this.ev(x.args[1],row,grp):0;return parseFloat(v.toFixed(d));}
          case 'ABS':return Math.abs(+this.ev(x.args[0],row,grp)||0);
          case 'FLOOR':return Math.floor(+this.ev(x.args[0],row,grp)||0);
          case 'CEIL':return Math.ceil(+this.ev(x.args[0],row,grp)||0);
          case 'CONCAT':return x.args.map(a=>String(this.ev(a,row,grp)??'')).join('');
          case 'COALESCE':{for(const a of x.args){const v=this.ev(a,row,grp);if(v!=null)return v;}return null;}
          case 'SUBSTR':case 'SUBSTRING':{const s=String(this.ev(x.args[0],row,grp)??'');const st=(+this.ev(x.args[1],row,grp)||1)-1;const l=x.args[2]?+this.ev(x.args[2],row,grp):undefined;return l!=null?s.substr(st,l):s.substr(st);}
          case 'REPLACE':{const s=String(this.ev(x.args[0],row,grp)??'');return s.split(String(this.ev(x.args[1],row,grp)??'')).join(String(this.ev(x.args[2],row,grp)??''));}
          case 'NOW':return new Date().toISOString().slice(0,19);
          case 'YEAR':return new Date(this.ev(x.args[0],row,grp)).getFullYear();
          case 'MONTH':return new Date(this.ev(x.args[0],row,grp)).getMonth()+1;
          case 'DAY':return new Date(this.ev(x.args[0],row,grp)).getDate();
          case 'NULLIF':{const a=this.ev(x.args[0],row,grp),b=this.ev(x.args[1],row,grp);return a==b?null:a;}
          case 'ISNULL':case 'NVL':{const v=this.ev(x.args[0],row,grp);return v==null?this.ev(x.args[1],row,grp):v;}
          default:return null;
        }
      }
      default:return null;
    }
  }

  select(ast){
    let rows=[{}];
    if(ast.from){const tbl=this._tbl(ast.from.name);rows=tbl.rows.map(r=>this._obj(tbl,ast.from.alias,r));}
    for(const j of(ast.joins||[])){
      const tbl=this._tbl(j.t.name);const jr=tbl.rows.map(r=>this._obj(tbl,j.t.alias,r));const nr=[];
      for(const lr of rows){let hit=false;for(const rr of jr){const c={...lr,...rr};if(this.ev(j.c,c)){nr.push(c);hit=true;}}
        if(!hit&&j.jt==='LEFT'){const nr2={};tbl.cols.forEach(c=>nr2[`${j.t.alias}.${c}`]=null);nr.push({...lr,...nr2});}}
      rows=nr;
    }
    if(ast.where)rows=rows.filter(r=>this.ev(ast.where,r));
    if(ast.groupBy){
      const g=new Map();
      for(const row of rows){const k=ast.groupBy.map(e=>JSON.stringify(this.ev(e,row))).join('\0');if(!g.has(k))g.set(k,{rep:row,rows:[]});g.get(k).rows.push(row);}
      rows=Array.from(g.values()).map(gr=>({...gr.rep,_grp:gr.rows}));
    }
    if(ast.having)rows=rows.filter(r=>this.ev(ast.having,r,r._grp||null));

    const isStar=ast.cols.length===1&&ast.cols[0].k==='star';
    let colNames,projected;
    if(isStar){
      const fr=rows[0]||{};const allK=Object.keys(fr).filter(k=>k!=='_grp');
      const seen=new Set(),cols=[];
      for(const k of allK){const n=k.includes('.')?k.split('.')[1]:k;if(!seen.has(n)){seen.add(n);cols.push({n,k});}}
      colNames=cols.map(c=>c.n);projected=rows.map(r=>cols.map(c=>r[c.k]??null));
    }else{
      colNames=ast.cols.map((col,i)=>{
        if(col.k==='star')return'*';if(col.alias)return col.alias;const e=col.expr;
        if(e.T==='col')return e.col;if(e.T==='call')return`${e.fn}(${e.star?'*':e.args.map(a=>a.T==='col'?a.col:'?').join(',')})`;
        if(e.T==='binop')return`expr${i+1}`;return`col${i+1}`;
      });
      projected=rows.map(r=>{const grp=r._grp||null;return ast.cols.map(col=>{if(col.k==='star')return null;return this.ev(col.expr,r,grp);});});
    }
    if(ast.distinct){const seen=new Set();projected=projected.filter(r=>{const k=JSON.stringify(r);if(seen.has(k))return false;seen.add(k);return true;});}
    if(ast.orderBy){
      const cm={};colNames.forEach((n,i)=>cm[n.toLowerCase()]=i);
      projected.sort((a,b)=>{
        for(const{e,d}of ast.orderBy){
          let av,bv;
          if(e.T==='lit'&&typeof e.val==='number'){av=a[e.val-1];bv=b[e.val-1];}
          else if(e.T==='col'){const idx=cm[e.col.toLowerCase()]??-1;av=idx>=0?a[idx]:null;bv=idx>=0?b[idx]:null;}
          else{av=null;bv=null;}
          let cmp;
          if(av==null)cmp=bv==null?0:1;else if(bv==null)cmp=-1;
          else if(typeof av==='string')cmp=av.localeCompare(bv);else cmp=av<bv?-1:av>bv?1:0;
          if(cmp!==0)return d==='DESC'?-cmp:cmp;
        }
        return 0;
      });
    }
    const off=ast.offset||0;
    if(ast.limit!=null)projected=projected.slice(off,off+ast.limit);else if(off>0)projected=projected.slice(off);
    return{kind:'rows',cols:colNames,rows:projected};
  }

  create(ast){const k=ast.name.toLowerCase();if(this.tables[k])throw new Error(`Table '${ast.name}' already exists`);this.tables[k]={cols:ast.cols.map(c=>c.name),rows:[]};return{kind:'msg',msg:`✓ Table '${ast.name}' created (${ast.cols.length} columns)`};}
  insert(ast){
    const tbl=this._tbl(ast.name);
    for(const ve of ast.rows){
      const vals=ve.map(e=>this.ev(e,{}));let row;
      if(ast.cols){row=new Array(tbl.cols.length).fill(null);ast.cols.forEach((c,i)=>{const idx=tbl.cols.findIndex(tc=>tc.toLowerCase()===c.toLowerCase());if(idx>=0)row[idx]=vals[i];});}
      else row=vals;tbl.rows.push(row);
    }
    return{kind:'msg',msg:`✓ ${ast.rows.length} row(s) inserted into '${ast.name}'`};
  }
  drop(ast){const k=Object.keys(this.tables).find(k=>k.toLowerCase()===ast.name.toLowerCase());if(!k)throw new Error(`Table '${ast.name}' not found`);delete this.tables[k];return{kind:'msg',msg:`✓ Table '${ast.name}' dropped`};}
  del(ast){
    const tbl=this._tbl(ast.name);const before=tbl.rows.length;
    if(ast.where){tbl.rows=tbl.rows.filter(r=>{const o={};tbl.cols.forEach((c,i)=>o[c]=r[i]);return!this.ev(ast.where,o);});}else tbl.rows=[];
    return{kind:'msg',msg:`✓ ${before-tbl.rows.length} row(s) deleted from '${ast.name}'`};
  }
  upd(ast){
    const tbl=this._tbl(ast.name);let cnt=0;
    tbl.rows=tbl.rows.map(r=>{const o={};tbl.cols.forEach((c,i)=>o[c]=r[i]);
      if(!ast.where||this.ev(ast.where,o)){const nr=[...r];ast.sets.forEach(({col,val})=>{const idx=tbl.cols.findIndex(c=>c.toLowerCase()===col.toLowerCase());if(idx>=0)nr[idx]=this.ev(val,o);});cnt++;return nr;}
      return r;});
    return{kind:'msg',msg:`✓ ${cnt} row(s) updated in '${ast.name}'`};
  }
}

/* ══════════════════════════════════════════════════════════════
   LINTER
══════════════════════════════════════════════════════════════ */
function lint(sql){
  const errors=[];let depth=0,inStr=false,strCh='';
  const lines=sql.split('\n');
  for(let li=0;li<lines.length;li++){
    const line=lines[li];let inLC=false;
    for(let ci=0;ci<line.length;ci++){
      const ch=line[ci];
      if(inLC)continue;
      if(inStr){if(ch===strCh)inStr=false;continue;}
      if(ch==='-'&&line[ci+1]==='-'){inLC=true;continue;}
      if(ch==="'"||ch==='"'){inStr=true;strCh=ch;continue;}
      if(ch==='(')depth++;
      if(ch===')'){depth--;if(depth<0){errors.push({line:li+1,col:ci+1,msg:'Unexpected closing parenthesis',sev:'error'});depth=0;}}
    }
  }
  if(inStr)errors.push({line:lines.length,col:1,msg:'Unclosed string literal',sev:'error'});
  if(depth>0)errors.push({line:lines.length,col:1,msg:`${depth} unclosed parenthesis`,sev:'error'});
  sql.split(';').map(s=>s.trim()).filter(Boolean).forEach(s=>{
    try{new SQLParser(tokenize(s)).stmt();}
    catch(e){errors.push({line:1,col:1,msg:e.message,sev:'error'});}
  });
  return errors;
}

/* ══════════════════════════════════════════════════════════════
   COOKBOOK DATA
══════════════════════════════════════════════════════════════ */
const COOKBOOK = [
  {id:'basics',label:'Basic SELECT',icon:'📋',items:[
    {title:'Select All Columns',desc:'Retrieve all columns from a table',sql:'SELECT * FROM employees;'},
    {title:'Select Specific Columns',desc:'Choose which columns to return',sql:'SELECT name, salary, hire_date\nFROM employees;'},
    {title:'Column Aliases',desc:'Rename columns in the output with AS',sql:'SELECT\n  name AS employee_name,\n  salary AS annual_pay\nFROM employees;'},
    {title:'Limit & Offset',desc:'Return a specific number of rows',sql:'SELECT * FROM products\nORDER BY price DESC\nLIMIT 5;'},
    {title:'Remove Duplicates',desc:'Use DISTINCT to deduplicate results',sql:'SELECT DISTINCT category\nFROM products\nORDER BY category;'},
    {title:'Computed Columns',desc:'Calculate new values in SELECT',sql:"SELECT\n  name,\n  salary,\n  ROUND(salary * 0.1, 2) AS bonus\nFROM employees;"},
  ]},
  {id:'filtering',label:'Filtering',icon:'🔍',items:[
    {title:'Basic WHERE',desc:'Filter rows by a condition',sql:'SELECT * FROM employees\nWHERE salary > 85000\nORDER BY salary DESC;'},
    {title:'AND / OR',desc:'Combine multiple conditions',sql:'SELECT * FROM employees\nWHERE salary > 70000\n  AND department_id = 1;'},
    {title:'LIKE Pattern',desc:'Match string patterns (% = any chars, _ = one char)',sql:"SELECT * FROM employees\nWHERE name LIKE 'A%';"},
    {title:'IN List',desc:'Match against a set of values',sql:"SELECT * FROM products\nWHERE category IN ('Electronics', 'Furniture');"},
    {title:'BETWEEN Range',desc:'Filter values within an inclusive range',sql:'SELECT * FROM employees\nWHERE salary BETWEEN 80000 AND 100000;'},
    {title:'NULL Checks',desc:'IS NULL / IS NOT NULL checks',sql:'SELECT * FROM employees\nWHERE hire_date IS NOT NULL;'},
    {title:'NOT IN',desc:'Exclude rows matching a list',sql:"SELECT * FROM products\nWHERE category NOT IN ('Stationery', 'Office');"},
  ]},
  {id:'aggregations',label:'Aggregations',icon:'📊',items:[
    {title:'COUNT',desc:'Count rows or non-null values',sql:'SELECT COUNT(*) AS total_employees\nFROM employees;'},
    {title:'SUM / AVG / MIN / MAX',desc:'Compute statistics on a column',sql:'SELECT\n  SUM(salary) AS total_payroll,\n  AVG(salary) AS avg_salary,\n  MIN(salary) AS min_salary,\n  MAX(salary) AS max_salary\nFROM employees;'},
    {title:'GROUP BY',desc:'Aggregate data by category',sql:'SELECT\n  department_id,\n  COUNT(*) AS headcount,\n  ROUND(AVG(salary), 0) AS avg_salary\nFROM employees\nGROUP BY department_id\nORDER BY avg_salary DESC;'},
    {title:'HAVING',desc:'Filter groups after aggregation',sql:'SELECT\n  department_id,\n  COUNT(*) AS headcount\nFROM employees\nGROUP BY department_id\nHAVING COUNT(*) > 2;'},
    {title:'Category Stats',desc:'Aggregate products by category',sql:'SELECT\n  category,\n  COUNT(*) AS products,\n  ROUND(AVG(price), 2) AS avg_price,\n  SUM(stock) AS total_stock\nFROM products\nGROUP BY category\nORDER BY avg_price DESC;'},
  ]},
  {id:'joins',label:'JOINs',icon:'🔗',items:[
    {title:'INNER JOIN',desc:'Match rows that exist in both tables',sql:'SELECT\n  e.name,\n  d.name AS department,\n  d.location,\n  e.salary\nFROM employees e\nJOIN departments d\n  ON e.department_id = d.id\nORDER BY e.salary DESC;'},
    {title:'LEFT JOIN',desc:'All left rows, with matched right rows (or NULLs)',sql:'SELECT\n  e.name,\n  d.name AS department\nFROM employees e\nLEFT JOIN departments d\n  ON e.department_id = d.id;'},
    {title:'Multi-table JOIN',desc:'Join three tables together',sql:'SELECT\n  o.id AS order_id,\n  p.name AS product,\n  p.category,\n  o.quantity,\n  o.total\nFROM orders o\nJOIN products p\n  ON o.product_id = p.id\nORDER BY o.total DESC;'},
    {title:'JOIN with Aggregation',desc:'Combine JOIN with GROUP BY',sql:'SELECT\n  d.name AS department,\n  COUNT(*) AS headcount,\n  ROUND(AVG(e.salary), 0) AS avg_salary\nFROM employees e\nJOIN departments d ON e.department_id = d.id\nGROUP BY d.name\nORDER BY avg_salary DESC;'},
  ]},
  {id:'strings',label:'String Functions',icon:'✏️',items:[
    {title:'UPPER / LOWER',desc:'Convert string case',sql:'SELECT name, UPPER(name) AS upper_name\nFROM employees;'},
    {title:'LENGTH',desc:'Get string length',sql:'SELECT name, LENGTH(name) AS name_length\nFROM employees\nORDER BY name_length DESC;'},
    {title:'SUBSTR',desc:'Extract a portion of a string',sql:"SELECT\n  name,\n  SUBSTR(name, 1, 5) AS first_5\nFROM employees;"},
    {title:'Concatenation (||)',desc:'Combine strings with ||',sql:"SELECT\n  name || ' — $' || salary AS employee_info\nFROM employees;"},
    {title:'REPLACE',desc:'Replace substrings within a string',sql:"SELECT name, REPLACE(name, ' ', '_') AS slug\nFROM employees;"},
    {title:'TRIM',desc:'Remove leading/trailing whitespace',sql:"SELECT TRIM(name) AS trimmed_name\nFROM employees;"},
  ]},
  {id:'ddl',label:'DDL',icon:'🏗️',items:[
    {title:'CREATE TABLE',desc:'Define a new table with typed columns',sql:"CREATE TABLE customers (\n  id INTEGER,\n  name VARCHAR(100),\n  email VARCHAR(255),\n  age INTEGER,\n  created_at DATE\n);"},
    {title:'DROP TABLE',desc:'Remove a table from the database',sql:'-- Warning: this permanently removes the table!\nDROP TABLE IF EXISTS customers;'},
    {title:'INSERT INTO',desc:'Add a new row to a table',sql:"INSERT INTO employees (id, name, department_id, salary, hire_date)\nVALUES (11, 'Lisa Park', 2, 76000, '2023-06-01');"},
    {title:'Multi-row INSERT',desc:'Insert multiple rows in one statement',sql:"INSERT INTO employees (id, name, department_id, salary, hire_date)\nVALUES\n  (12, 'Mike Ross', 1, 93000, '2023-07-15'),\n  (13, 'Nancy Drew', 3, 82000, '2023-08-20');"},
  ]},
  {id:'dml',label:'DML',icon:'✍️',items:[
    {title:'UPDATE rows',desc:'Modify existing records',sql:'UPDATE employees\nSET salary = salary * 1.1\nWHERE department_id = 1;'},
    {title:'DELETE rows',desc:'Remove rows matching a condition',sql:'DELETE FROM employees\nWHERE salary < 70000;'},
    {title:'Conditional UPDATE',desc:'Update with a CASE expression',sql:"UPDATE employees\nSET salary = CASE\n  WHEN department_id = 1 THEN salary * 1.15\n  WHEN department_id = 2 THEN salary * 1.08\n  ELSE salary * 1.05\nEND;"},
  ]},
  {id:'advanced',label:'Advanced',icon:'⚡',items:[
    {title:'CASE Expression',desc:'Conditional logic in SELECT clause',sql:"SELECT\n  name,\n  salary,\n  CASE\n    WHEN salary >= 100000 THEN 'Senior'\n    WHEN salary >= 80000 THEN 'Mid-level'\n    ELSE 'Junior'\n  END AS level\nFROM employees\nORDER BY salary DESC;"},
    {title:'String Aggregation Pattern',desc:'Get stats along with grouping',sql:'SELECT\n  department_id,\n  COUNT(*) AS count,\n  ROUND(AVG(salary), 0) AS avg_salary,\n  MAX(salary) AS top_salary\nFROM employees\nGROUP BY department_id\nORDER BY department_id;'},
    {title:'COALESCE (NULL handling)',desc:'Return first non-null value',sql:'SELECT\n  name,\n  COALESCE(salary, 0) AS salary\nFROM employees;'},
    {title:'String functions chain',desc:'Combine multiple string functions',sql:"SELECT\n  name,\n  UPPER(SUBSTR(name, 1, 1)) || LOWER(SUBSTR(name, 2)) AS formatted\nFROM employees;"},
  ]},
];

/* ══════════════════════════════════════════════════════════════
   CHART HELPER
══════════════════════════════════════════════════════════════ */
const CHART_COLORS = ['#F59E0B','#3B82F6','#10B981','#EF4444','#8B5CF6','#EC4899'];
function getChartConfig(cols, rows) {
  if(!cols?.length||!rows?.length)return null;
  const numIdx=[],strIdx=[];
  cols.forEach((col,i)=>{
    const samp=rows.slice(0,10).map(r=>r[i]).filter(v=>v!=null);
    if(samp.length&&samp.every(v=>!isNaN(+v)))numIdx.push(i);else strIdx.push(i);
  });
  if(!numIdx.length)return null;
  const labelIdx=strIdx[0]??-1;
  return{
    data:rows.map((row,ri)=>{
      const item={_lbl:labelIdx>=0?String(row[labelIdx]??''):`Row ${ri+1}`};
      numIdx.forEach(i=>{item[cols[i]]=parseFloat(row[i])||0;});return item;
    }),
    numCols:numIdx.map(i=>cols[i]),
  };
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
const DEFAULT_SQL = `-- 🗄️ Welcome to SQL Codelab!
-- Tables: employees, departments, products, orders
-- Press ▶ Run or Ctrl+Enter to execute queries

SELECT
  e.name,
  d.name AS department,
  e.salary
FROM employees e
JOIN departments d ON e.department_id = d.id
WHERE e.salary > 80000
ORDER BY e.salary DESC;`;

const MONO = "'JetBrains Mono','Fira Code','Cascadia Code','Courier New',monospace";
const SANS = "'Inter','Segoe UI',system-ui,sans-serif";
const BG='#0D1117',SURF='#161B22',SURF2='#1C2128',BORDER='#21262D',TEXT='#E6EDF3',MUTED='#7D8590',AMBER='#F59E0B',GREEN='#3FB950',RED='#F85149';

export default function SQLCodelab() {
  const [tab, setTab] = useState('editor');
  const [sql, setSQL] = useState(DEFAULT_SQL);
  const [results, setResults] = useState(null);
  const [execErr, setExecErr] = useState(null);
  const [lintErrors, setLintErrors] = useState([]);
  const [resultView, setResultView] = useState('table');
  const [cookCat, setCookCat] = useState('basics');
  const [schemaVer, setSchemaVer] = useState(0);
  const [expandedTbls, setExpandedTbls] = useState(new Set(['employees','departments']));
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [copiedSnippet, setCopiedSnippet] = useState(null);

  const db = useRef(new Database());
  const taRef = useRef(null);
  const hlRef = useRef(null);
  const lnRef = useRef(null);

  const onScroll = useCallback(() => {
    if(hlRef.current&&taRef.current){hlRef.current.scrollTop=taRef.current.scrollTop;hlRef.current.scrollLeft=taRef.current.scrollLeft;}
    if(lnRef.current&&taRef.current){lnRef.current.scrollTop=taRef.current.scrollTop;}
  }, []);

  useEffect(() => {
    const t=setTimeout(()=>{try{setLintErrors(lint(sql));}catch{setLintErrors([]);}},400);
    return()=>clearTimeout(t);
  }, [sql]);

  const highlighted = useMemo(() => highlight(sql), [sql]);
  const lineCount = useMemo(() => sql.split('\n').length, [sql]);

  const run = useCallback(() => {
    setExecErr(null);setSortCol(null);
    try{const res=db.current.run(sql);setResults(res);setSchemaVer(v=>v+1);}
    catch(e){setExecErr(e.message);setResults(null);}
  }, [sql]);

  useEffect(() => {
    const h=(e)=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();run();}};
    window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h);
  }, [run]);

  const onKeyDown = useCallback((e) => {
    if(e.key==='Tab'){
      e.preventDefault();const ta=taRef.current;const s=ta.selectionStart,en=ta.selectionEnd;
      const nv=sql.slice(0,s)+'  '+sql.slice(en);setSQL(nv);
      requestAnimationFrame(()=>{ta.selectionStart=ta.selectionEnd=s+2;});
    }
  }, [sql]);

  const schema = db.current.tables;
  const displayResult = results?.filter(r=>r.kind==='rows').at(-1);
  const messages = results?.filter(r=>r.kind==='msg');

  // Sorted display result
  const sortedResult = useMemo(() => {
    if(!displayResult||!sortCol)return displayResult;
    const colIdx=displayResult.cols.indexOf(sortCol);if(colIdx<0)return displayResult;
    const sorted=[...displayResult.rows].sort((a,b)=>{
      const av=a[colIdx],bv=b[colIdx];let cmp;
      if(av==null)cmp=bv==null?0:1;else if(bv==null)cmp=-1;
      else if(typeof av==='string')cmp=av.localeCompare(bv);else cmp=av<bv?-1:av>bv?1:0;
      return sortDir==='desc'?-cmp:cmp;
    });
    return{...displayResult,rows:sorted};
  }, [displayResult,sortCol,sortDir]);

  const chartConfig = useMemo(() => sortedResult?getChartConfig(sortedResult.cols,sortedResult.rows):null, [sortedResult]);

  const edS = {fontFamily:MONO,fontSize:'13px',lineHeight:'1.65',padding:'12px 16px 12px 52px',tabSize:2,whiteSpace:'pre-wrap',wordBreak:'break-all',textAlign:'left'};

  function copySnippet(sql, id) {
    navigator.clipboard.writeText(sql).catch(()=>{});
    setCopiedSnippet(id);setTimeout(()=>setCopiedSnippet(null),1500);
  }

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100vh',width:'100%',background:BG,color:TEXT,fontFamily:SANS,overflow:'hidden'}}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { width: 100%; height: 100%; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${SURF}; }
        ::-webkit-scrollbar-thumb { background: #30363D; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #484F58; }
        textarea { outline: none; border: none; resize: none; }
        .btn-hover:hover { filter: brightness(1.15); }
        .row-hover:hover { background: rgba(255,255,255,0.04) !important; }
        .schema-row:hover { background: rgba(255,255,255,0.05); }
        .snippet-card:hover { border-color: ${AMBER}44 !important; }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{display:'flex',alignItems:'center',gap:16,padding:'0 20px',height:50,borderBottom:`1px solid ${BORDER}`,background:SURF,flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:22}}>🗄️</span>
          <span style={{fontFamily:MONO,fontSize:15,fontWeight:700,color:AMBER,letterSpacing:'0.05em'}}>SQL Codelab</span>
        </div>
        <div style={{display:'flex',gap:4,marginLeft:8}}>
          {['editor','cookbook'].map(t=>(
            <button key={t} onClick={()=>setTab(t)} className="btn-hover" style={{padding:'5px 14px',borderRadius:6,border:'none',background:tab===t?AMBER:'transparent',color:tab===t?BG:MUTED,fontFamily:SANS,fontSize:13,fontWeight:600,cursor:'pointer',transition:'all 0.15s',letterSpacing:'0.03em'}}>
              {t==='editor'?'⌨️  Editor':'📚  Cookbook'}
            </button>
          ))}
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          {lintErrors.length>0&&<span style={{fontSize:12,color:RED,fontFamily:MONO}}>⚠ {lintErrors.length} issue{lintErrors.length>1?'s':''}</span>}
          <span style={{fontSize:11,color:MUTED,fontFamily:MONO}}>{lineCount} lines</span>
        </div>
      </header>

      {tab==='editor' ? (
        /* ── EDITOR TAB ── */
        <div style={{display:'flex',flex:1,overflow:'hidden'}}>

          {/* Schema Sidebar */}
          <aside style={{width:210,borderRight:`1px solid ${BORDER}`,background:SURF,display:'flex',flexDirection:'column',overflow:'hidden',flexShrink:0}}>
            <div style={{padding:'10px 12px 6px',fontSize:10,fontWeight:700,letterSpacing:'0.1em',color:MUTED,textTransform:'uppercase'}}>Schema Browser</div>
            <div style={{overflowY:'auto',flex:1}}>
              {Object.entries(schema).map(([tname,tbl])=>(
                <div key={tname+schemaVer}>
                  <div className="schema-row" onClick={()=>setExpandedTbls(s=>{const n=new Set(s);n.has(tname)?n.delete(tname):n.add(tname);return n;})}
                    style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',cursor:'pointer',userSelect:'none'}}>
                    <span style={{fontSize:10,color:MUTED,transition:'transform 0.15s',transform:expandedTbls.has(tname)?'rotate(90deg)':'none',display:'inline-block'}}>▶</span>
                    <span style={{fontSize:12,fontFamily:MONO,color:TEXT}}>📋 {tname}</span>
                    <span style={{marginLeft:'auto',fontSize:10,color:MUTED,fontFamily:MONO}}>{tbl.rows.length}r</span>
                  </div>
                  {expandedTbls.has(tname)&&tbl.cols.map(col=>(
                    <div key={col} style={{padding:'3px 12px 3px 30px',fontSize:11,fontFamily:MONO,color:'#8B949E',display:'flex',alignItems:'center',gap:6}}>
                      <span style={{color:'#3B82F6',fontSize:9}}>●</span>{col}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{borderTop:`1px solid ${BORDER}`,padding:'10px 12px'}}>
              <button onClick={()=>{db.current.seed();setSchemaVer(v=>v+1);setResults(null);setExecErr(null);}} className="btn-hover"
                style={{width:'100%',padding:'6px',background:'#21262D',border:`1px solid ${BORDER}`,borderRadius:6,color:MUTED,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>
                ↺ Reset Database
              </button>
            </div>
          </aside>

          {/* Main Editor + Results */}
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

            {/* Toolbar */}
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',borderBottom:`1px solid ${BORDER}`,background:SURF,flexShrink:0}}>
              <button onClick={run} className="btn-hover" style={{display:'flex',alignItems:'center',gap:6,padding:'6px 16px',background:AMBER,color:BG,border:'none',borderRadius:6,fontWeight:700,fontSize:13,fontFamily:SANS,cursor:'pointer',letterSpacing:'0.02em'}}>
                ▶ Run
              </button>
              <button onClick={()=>setSQL(DEFAULT_SQL)} className="btn-hover" style={{padding:'6px 12px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:6,color:MUTED,fontSize:12,fontFamily:SANS,cursor:'pointer'}}>
                ↺ Reset
              </button>
              <button onClick={()=>setSQL('')} className="btn-hover" style={{padding:'6px 12px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:6,color:MUTED,fontSize:12,fontFamily:SANS,cursor:'pointer'}}>
                ✕ Clear
              </button>
              <div style={{marginLeft:'auto',fontSize:11,color:MUTED,fontFamily:MONO}}>Ctrl+Enter to run</div>
            </div>

            {/* Code Editor */}
            <div style={{flex:'0 0 52%',position:'relative',overflow:'hidden',borderBottom:`1px solid ${BORDER}`}}>
              {/* Line numbers */}
              <div ref={lnRef} style={{position:'absolute',left:0,top:0,bottom:0,width:44,background:'#0D1117',borderRight:`1px solid ${BORDER}`,overflowY:'hidden',pointerEvents:'none',zIndex:2}}>
                <div style={{...edS,padding:'12px 8px 12px 0',color:'#3D4451',textAlign:'right',userSelect:'none',fontSize:'12px'}}>
                  {Array.from({length:lineCount},(_,i)=>`${i+1}\n`).join('')}
                </div>
              </div>
              {/* Highlight overlay */}
              <pre ref={hlRef} aria-hidden style={{...edS,position:'absolute',top:0,left:0,right:0,bottom:0,margin:0,overflow:'hidden',pointerEvents:'none',zIndex:1,color:TEXT}} dangerouslySetInnerHTML={{__html:highlighted+'<br/>'}}/>
              {/* Textarea */}
              <textarea ref={taRef} value={sql} onChange={e=>setSQL(e.target.value)} onScroll={onScroll} onKeyDown={onKeyDown}
                spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
                style={{...edS,position:'absolute',top:0,left:0,right:0,bottom:0,width:'100%',height:'100%',background:'transparent',color:'transparent',caretColor:AMBER,zIndex:3,overflowY:'auto',overflowX:'auto'}}/>
            </div>

            {/* Lint Errors */}
            {lintErrors.length>0&&(
              <div style={{background:'#1A0E0E',borderBottom:`1px solid #5C1A1A`,padding:'6px 16px',flexShrink:0,maxHeight:90,overflowY:'auto'}}>
                {lintErrors.map((e,i)=>(
                  <div key={i} style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:12,fontFamily:MONO,color:'#FF7B7B',lineHeight:'1.6'}}>
                    <span style={{color:RED,flexShrink:0}}>● ERR</span>
                    <span style={{color:MUTED,flexShrink:0}}>L{e.line}</span>
                    <span>{e.msg}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Results Panel */}
            <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column',minHeight:0}}>
              {/* Results Toolbar */}
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 14px',borderBottom:`1px solid ${BORDER}`,background:SURF,flexShrink:0}}>
                <span style={{fontSize:12,fontWeight:600,color:MUTED,letterSpacing:'0.05em',textTransform:'uppercase'}}>Results</span>
                {sortedResult&&<>
                  <span style={{fontSize:11,color:GREEN,fontFamily:MONO,marginLeft:4}}>✓ {sortedResult.rows.length} rows × {sortedResult.cols.length} cols</span>
                  <div style={{display:'flex',gap:4,marginLeft:'auto'}}>
                    {['table','chart','pie'].map(v=>(
                      <button key={v} onClick={()=>setResultView(v)} className="btn-hover" style={{padding:'3px 10px',borderRadius:5,border:`1px solid ${resultView===v?AMBER:BORDER}`,background:resultView===v?AMBER+'22':'transparent',color:resultView===v?AMBER:MUTED,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>
                        {v==='table'?'⊞ Table':v==='chart'?'📊 Bar':'◉ Pie'}
                      </button>
                    ))}
                  </div>
                </>}
                {execErr&&<span style={{fontSize:12,color:RED,fontFamily:MONO}}>✕ Error</span>}
              </div>

              {/* Results Content */}
              <div style={{flex:1,overflow:'auto',padding:'0'}}>
                {execErr&&(
                  <div style={{margin:16,padding:12,background:'#1A0E0E',border:`1px solid ${RED}44`,borderRadius:8,fontFamily:MONO,fontSize:13,color:'#FF7B7B'}}>
                    <span style={{color:RED}}>✕ </span>{execErr}
                  </div>
                )}

                {messages?.map((m,i)=>(
                  <div key={i} style={{margin:'8px 16px',padding:'8px 12px',background:'#0D1F0D',border:`1px solid ${GREEN}44`,borderRadius:6,fontFamily:MONO,fontSize:12,color:GREEN}}>{m.msg}</div>
                ))}

                {sortedResult&&resultView==='table'&&(
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,fontFamily:MONO}}>
                      <thead>
                        <tr style={{background:SURF,position:'sticky',top:0,zIndex:5}}>
                          <th style={{padding:'8px 12px',textAlign:'right',fontWeight:400,color:MUTED,fontSize:11,borderBottom:`2px solid ${AMBER}44`,width:40}}>#</th>
                          {sortedResult.cols.map(col=>(
                            <th key={col} onClick={()=>{if(sortCol===col)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortCol(col);setSortDir('asc');}}}
                              style={{padding:'8px 14px',textAlign:'left',fontWeight:600,color:sortCol===col?AMBER:TEXT,fontSize:12,borderBottom:`2px solid ${sortCol===col?AMBER:BORDER}`,cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}}>
                              {col}{sortCol===col?sortDir==='asc'?' ↑':' ↓':''}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedResult.rows.map((row,ri)=>(
                          <tr key={ri} className="row-hover" style={{borderBottom:`1px solid ${BORDER}22`,background:ri%2?'transparent':'rgba(255,255,255,0.02)'}}>
                            <td style={{padding:'7px 12px',color:MUTED,textAlign:'right',fontSize:11}}>{ri+1}</td>
                            {row.map((cell,ci)=>{
                              const isNum=cell!==null&&!isNaN(+cell)&&typeof cell!=='string';
                              return(
                                <td key={ci} style={{padding:'7px 14px',color:cell===null?MUTED:isNum?'#B5CEA8':TEXT,fontStyle:cell===null?'italic':'normal',whiteSpace:'nowrap',maxWidth:280,overflow:'hidden',textOverflow:'ellipsis'}}>
                                  {cell===null?'NULL':String(cell)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {sortedResult&&resultView==='chart'&&chartConfig&&(
                  <div style={{padding:16}}>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={chartConfig.data} margin={{top:8,right:16,left:0,bottom:40}}>
                        <CartesianGrid strokeDasharray="3 3" stroke={BORDER}/>
                        <XAxis dataKey="_lbl" tick={{fill:MUTED,fontSize:11,fontFamily:MONO}} angle={-30} textAnchor="end" interval={0}/>
                        <YAxis tick={{fill:MUTED,fontSize:11,fontFamily:MONO}}/>
                        <Tooltip contentStyle={{background:SURF2,border:`1px solid ${BORDER}`,borderRadius:8,fontFamily:MONO,fontSize:12}}/>
                        {chartConfig.numCols.map((col,i)=>(
                          <Bar key={col} dataKey={col} fill={CHART_COLORS[i%CHART_COLORS.length]} radius={[4,4,0,0]}/>
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {sortedResult&&resultView==='pie'&&chartConfig&&(
                  <div style={{padding:16}}>
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={chartConfig.data} dataKey={chartConfig.numCols[0]} nameKey="_lbl" cx="50%" cy="50%" outerRadius={100} label={({_lbl,percent})=>`${_lbl} (${(percent*100).toFixed(0)}%)`} labelLine={false}>
                          {chartConfig.data.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}
                        </Pie>
                        <Tooltip contentStyle={{background:SURF2,border:`1px solid ${BORDER}`,borderRadius:8,fontFamily:MONO,fontSize:12}}/>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {sortedResult&&resultView==='chart'&&!chartConfig&&(
                  <div style={{padding:32,textAlign:'center',color:MUTED,fontSize:13}}>No numeric columns detected for chart visualization.</div>
                )}

                {!results&&!execErr&&(
                  <div style={{padding:32,textAlign:'center',color:MUTED,fontSize:13}}>
                    <div style={{fontSize:32,marginBottom:12}}>▶</div>
                    Run a query to see results here
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── COOKBOOK TAB ── */
        <div style={{display:'flex',flex:1,overflow:'hidden'}}>
          {/* Category Sidebar */}
          <aside style={{width:190,borderRight:`1px solid ${BORDER}`,background:SURF,overflowY:'auto',flexShrink:0}}>
            <div style={{padding:'10px 12px 6px',fontSize:10,fontWeight:700,letterSpacing:'0.1em',color:MUTED,textTransform:'uppercase'}}>Categories</div>
            {COOKBOOK.map(cat=>(
              <div key={cat.id} onClick={()=>setCookCat(cat.id)} className="schema-row"
                style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',cursor:'pointer',background:cookCat===cat.id?AMBER+'18':'transparent',borderLeft:`3px solid ${cookCat===cat.id?AMBER:'transparent'}`,transition:'all 0.15s'}}>
                <span style={{fontSize:14}}>{cat.icon}</span>
                <span style={{fontSize:12,fontWeight:cookCat===cat.id?600:400,color:cookCat===cat.id?AMBER:TEXT}}>{cat.label}</span>
              </div>
            ))}
          </aside>

          {/* Snippet Grid */}
          <div style={{flex:1,overflowY:'auto',padding:20}}>
            {COOKBOOK.filter(c=>c.id===cookCat).map(cat=>(
              <div key={cat.id}>
                <h2 style={{margin:'0 0 16px',fontSize:18,fontWeight:700,color:TEXT,textAlign:'left'}}>
                  {cat.icon} {cat.label}
                  <span style={{marginLeft:10,fontSize:12,fontWeight:400,color:MUTED}}>{cat.items.length} snippets</span>
                </h2>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(380px,1fr))',gap:14}}>
                  {cat.items.map((item,idx)=>(
                    <div key={idx} className="snippet-card" style={{background:SURF,border:`1px solid ${BORDER}`,borderRadius:10,overflow:'hidden',transition:'border-color 0.15s'}}>
                      <div style={{padding:'12px 16px 8px',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                        <div>
                          <div style={{fontSize:13,fontWeight:700,color:TEXT,marginBottom:3}}>{item.title}</div>
                          <div style={{fontSize:11,color:MUTED,lineHeight:'1.4'}}>{item.desc}</div>
                        </div>
                        <div style={{display:'flex',gap:6,marginLeft:12,flexShrink:0}}>
                          <button onClick={()=>copySnippet(item.sql,`${cat.id}-${idx}`)} className="btn-hover"
                            style={{padding:'4px 10px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:5,color:MUTED,fontSize:11,fontFamily:SANS,cursor:'pointer',whiteSpace:'nowrap'}}>
                            {copiedSnippet===`${cat.id}-${idx}`?'✓ Copied':'⎘ Copy'}
                          </button>
                          <button onClick={()=>{setSQL(item.sql);setTab('editor');}} className="btn-hover"
                            style={{padding:'4px 10px',background:AMBER+'22',border:`1px solid ${AMBER}44`,borderRadius:5,color:AMBER,fontSize:11,fontFamily:SANS,cursor:'pointer',whiteSpace:'nowrap'}}>
                            ▶ Try
                          </button>
                        </div>
                      </div>
                      <pre style={{margin:0,padding:'10px 16px 12px',background:'#0D1117',fontSize:12,fontFamily:MONO,lineHeight:'1.6',overflowX:'auto',color:TEXT,textAlign:'left'}} dangerouslySetInnerHTML={{__html:highlight(item.sql)}}/>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status Bar */}
      <div style={{display:'flex',alignItems:'center',gap:16,padding:'0 16px',height:24,background:'#0A0D12',borderTop:`1px solid ${BORDER}`,fontSize:11,fontFamily:MONO,color:MUTED,flexShrink:0}}>
        <span style={{color:lintErrors.length?RED:GREEN}}>● {lintErrors.length?`${lintErrors.length} error${lintErrors.length>1?'s':''}`:'No errors'}</span>
        <span>Tables: {Object.keys(schema).length}</span>
        {sortedResult&&<span style={{color:GREEN}}>Last result: {sortedResult.rows.length} rows</span>}
        <span style={{marginLeft:'auto'}}>SQL Codelab v1.0 · In-memory engine</span>
      </div>
    </div>
  );
}