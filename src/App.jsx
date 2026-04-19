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
    if(this.try_('LIMIT')){const n1=+this.next().v;if(this.try_(',')){offset=n1;limit=+this.next().v;}else{limit=n1;if(this.try_('OFFSET'))offset=+this.next().v;}}
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

  drop_(){this.expect('DROP');this.expect('TABLE');this.try_('IF');this.try_('EXISTS');const names=[];do{names.push(this.next().v);}while(this.try_(','));return{T:'DROP',names:names};}

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
  drop(ast){const names=ast.names||[ast.name];const dropped=[];for(const name of names){const k=Object.keys(this.tables).find(k=>k.toLowerCase()===name.toLowerCase());if(k){delete this.tables[k];dropped.push(name);}}return{kind:'msg',msg:`✓ Table(s) '${dropped.join(', ')}' dropped`};};
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
   PRACTICE PROBLEMS
══════════════════════════════════════════════════════════════ */
const PRACTICE_PROBLEMS = [
  {
    id: 'p1',
    title: 'Max Salary Per Department',
    difficulty: 'Hard',
    category: 'Aggregation',
    tags: ['JOIN', 'GROUP BY', 'MAX', 'ORDER BY'],
    description: 'Find the maximum salary in each department. Display the **department name** (not ID) and the maximum salary aliased as `max_salary`. Sort the results by max salary in descending order.\n\nAvailable tables: `employees(id, name, department_id, salary, hire_date)`, `departments(id, name, location)`',
    hint: 'JOIN employees with departments on `e.department_id = d.id`, then GROUP BY the department name and apply MAX(e.salary). Don\'t forget ORDER BY.',
    solutionSql: `SELECT d.name AS department, MAX(e.salary) AS max_salary\nFROM employees e\nJOIN departments d ON e.department_id = d.id\nGROUP BY d.name\nORDER BY max_salary DESC;`,
    check: (rows, cols) => {
      if (!rows || rows.length === 0) return { ok: false, msg: 'No rows returned. Make sure your query runs without errors.' };
      if (rows.length !== 5) return { ok: false, msg: `Expected 5 rows (one per department), got ${rows.length}. Check your GROUP BY clause.` };
      const colsLower = cols.map(c => c.toLowerCase());
      const hasSalary = colsLower.some(c => c.includes('salary') || c.includes('max'));
      if (!hasSalary) return { ok: false, msg: 'Missing a salary/max column. Alias it as max_salary.' };
      const hasDept = colsLower.some(c => c.includes('dept') || c.includes('name') || c.includes('department'));
      if (!hasDept) return { ok: false, msg: 'Missing a department name column. Make sure you JOIN and select the department name.' };
      return { ok: true, msg: '✓ Correct! All 5 departments shown with their top salary, ordered highest first.' };
    }
  },
  {
    id: 'p2',
    title: 'High-Earning Departments',
    difficulty: 'Hard',
    category: 'HAVING',
    tags: ['JOIN', 'GROUP BY', 'HAVING', 'AVG', 'ROUND'],
    description: 'List only the departments where the **average salary exceeds $85,000**. For each qualifying department show: department name, average salary rounded to 2 decimals aliased as `avg_salary`, and employee count aliased as `emp_count`. Sort by avg_salary descending.\n\nAvailable tables: `employees`, `departments`',
    hint: 'Use HAVING AVG(e.salary) > 85000 after GROUP BY d.name. Use ROUND(AVG(e.salary), 2) and COUNT(*) in SELECT.',
    solutionSql: `SELECT d.name AS department, ROUND(AVG(e.salary), 2) AS avg_salary, COUNT(*) AS emp_count\nFROM employees e\nJOIN departments d ON e.department_id = d.id\nGROUP BY d.name\nHAVING AVG(e.salary) > 85000\nORDER BY avg_salary DESC;`,
    check: (rows, cols) => {
      if (!rows || rows.length === 0) return { ok: false, msg: 'No rows returned. Did you forget the HAVING clause?' };
      if (rows.length !== 2) return { ok: false, msg: `Expected 2 departments (Engineering & Finance), got ${rows.length}. Check your HAVING threshold.` };
      const colsLower = cols.map(c => c.toLowerCase());
      const hasAvg = colsLower.some(c => c.includes('avg') || c.includes('salary'));
      const hasCount = colsLower.some(c => c.includes('count') || c.includes('emp'));
      if (!hasAvg) return { ok: false, msg: 'Missing avg_salary column.' };
      if (!hasCount) return { ok: false, msg: 'Missing emp_count column — add COUNT(*) AS emp_count.' };
      return { ok: true, msg: '✓ Correct! Engineering and Finance are the two departments above $85k average.' };
    }
  },
  {
    id: 'p3',
    title: 'Product Revenue Ranking',
    difficulty: 'Hard',
    category: 'Multi-Join + HAVING',
    tags: ['JOIN', 'GROUP BY', 'SUM', 'HAVING', 'ORDER BY'],
    description: 'Calculate total revenue per product from the orders table. Display product `name`, `category`, and total revenue aliased as `total_revenue`. **Only include products that appear in at least 2 orders.** Sort by total revenue descending.\n\nAvailable tables: `products(id, name, category, price, stock)`, `orders(id, product_id, quantity, total, order_date)`',
    hint: 'JOIN orders with products on `o.product_id = p.id`. Use SUM(o.total) for revenue, GROUP BY p.name and p.category, then filter with HAVING COUNT(*) >= 2.',
    solutionSql: `SELECT p.name, p.category, SUM(o.total) AS total_revenue\nFROM orders o\nJOIN products p ON o.product_id = p.id\nGROUP BY p.name, p.category\nHAVING COUNT(*) >= 2\nORDER BY total_revenue DESC;`,
    check: (rows, cols) => {
      if (!rows || rows.length === 0) return { ok: false, msg: 'No rows returned. Did you join the tables correctly?' };
      const colsLower = cols.map(c => c.toLowerCase());
      const hasRevenue = colsLower.some(c => c.includes('revenue') || c.includes('total') || c.includes('sum'));
      const hasCategory = colsLower.some(c => c.includes('category') || c.includes('cat'));
      if (!hasRevenue) return { ok: false, msg: 'Missing total_revenue column — use SUM(o.total) AS total_revenue.' };
      if (!hasCategory) return { ok: false, msg: 'Missing category column — include p.category in SELECT and GROUP BY.' };
      if (rows.length > 8) return { ok: false, msg: `Got ${rows.length} rows — too many. Apply HAVING COUNT(*) >= 2 to filter products with fewer than 2 orders.` };
      return { ok: true, msg: `✓ Correct! Found ${rows.length} products with 2+ orders, ranked by revenue.` };
    }
  },
  {
    id: 'p4',
    title: 'Electronics Inventory Value',
    difficulty: 'Medium',
    category: 'Computed Columns',
    tags: ['WHERE', 'Expressions', 'ROUND', 'ORDER BY'],
    description: 'For the **Electronics category only**, calculate the total inventory value for each product as `price × stock`. Display: `name`, `price`, `stock`, and inventory value aliased as `inventory_value` (rounded to 2 decimals). Sort by inventory_value descending.\n\nAvailable table: `products(id, name, category, price, stock)`',
    hint: "Filter with WHERE category = 'Electronics'. Use ROUND(price * stock, 2) AS inventory_value in SELECT.",
    solutionSql: `SELECT name, price, stock, ROUND(price * stock, 2) AS inventory_value\nFROM products\nWHERE category = 'Electronics'\nORDER BY inventory_value DESC;`,
    check: (rows, cols) => {
      if (!rows || rows.length === 0) return { ok: false, msg: "No rows returned. Check your WHERE category = 'Electronics' filter." };
      if (rows.length !== 4) return { ok: false, msg: `Expected 4 Electronics products, got ${rows.length}.` };
      const colsLower = cols.map(c => c.toLowerCase());
      const hasValue = colsLower.some(c => c.includes('value') || c.includes('inventory'));
      if (!hasValue) return { ok: false, msg: 'Missing inventory_value column — alias your computed column.' };
      return { ok: true, msg: '✓ Correct! All 4 Electronics products shown with calculated inventory values.' };
    }
  },
  {
    id: 'p5',
    title: 'Top 3 Highest-Value Orders',
    difficulty: 'Hard',
    category: 'Ranking',
    tags: ['JOIN', 'ORDER BY', 'LIMIT'],
    description: 'Find the **top 3 individual orders** by total value. Display: order `id` aliased as `order_id`, product `name` aliased as `product`, `quantity`, and order `total`. Show exactly 3 rows — the three most expensive orders.\n\nAvailable tables: `orders`, `products`',
    hint: 'JOIN orders with products on o.product_id = p.id. No GROUP BY needed — you want individual rows. Use ORDER BY o.total DESC LIMIT 3.',
    solutionSql: `SELECT o.id AS order_id, p.name AS product, o.quantity, o.total\nFROM orders o\nJOIN products p ON o.product_id = p.id\nORDER BY o.total DESC\nLIMIT 3;`,
    check: (rows, cols) => {
      if (!rows || rows.length === 0) return { ok: false, msg: 'No rows returned.' };
      if (rows.length !== 3) return { ok: false, msg: `Expected exactly 3 rows, got ${rows.length}. Add LIMIT 3 and ORDER BY total DESC.` };
      const colsLower = cols.map(c => c.toLowerCase());
      const hasProduct = colsLower.some(c => c.includes('product') || c.includes('name'));
      if (!hasProduct) return { ok: false, msg: 'Missing product name column — JOIN with products to get the name.' };
      return { ok: true, msg: '✓ Correct! The 3 highest-value orders retrieved with product details.' };
    }
  },
  {
    id: 'p6',
    title: 'Department Headcount & Budget',
    difficulty: 'Hard',
    category: 'Full Aggregation',
    tags: ['JOIN', 'GROUP BY', 'HAVING', 'COUNT', 'SUM', 'AVG'],
    description: 'For each department with **more than 1 employee**, calculate: headcount aliased as `headcount`, total salary budget aliased as `total_budget`, and average salary aliased as `avg_salary` (rounded to 0 decimals). Show the department **name**. Sort by total_budget descending.\n\nAvailable tables: `employees`, `departments`',
    hint: 'JOIN employees with departments, GROUP BY d.name, then HAVING COUNT(*) > 1. Use COUNT(*), SUM(e.salary), ROUND(AVG(e.salary), 0).',
    solutionSql: `SELECT d.name AS department, COUNT(*) AS headcount, SUM(e.salary) AS total_budget, ROUND(AVG(e.salary), 0) AS avg_salary\nFROM employees e\nJOIN departments d ON e.department_id = d.id\nGROUP BY d.name\nHAVING COUNT(*) > 1\nORDER BY total_budget DESC;`,
    check: (rows, cols) => {
      if (!rows || rows.length === 0) return { ok: false, msg: 'No rows returned. Check your JOIN and GROUP BY.' };
      const colsLower = cols.map(c => c.toLowerCase());
      const hasCount = colsLower.some(c => c.includes('count') || c.includes('head'));
      const hasBudget = colsLower.some(c => c.includes('budget') || c.includes('sum') || c.includes('total'));
      const hasAvg = colsLower.some(c => c.includes('avg') || c.includes('salary'));
      if (!hasCount) return { ok: false, msg: 'Missing headcount — add COUNT(*) AS headcount.' };
      if (!hasBudget) return { ok: false, msg: 'Missing total_budget — add SUM(e.salary) AS total_budget.' };
      if (!hasAvg) return { ok: false, msg: 'Missing avg_salary — add ROUND(AVG(e.salary), 0) AS avg_salary.' };
      if (rows.length < 2) return { ok: false, msg: `Only ${rows.length} row — check your HAVING COUNT(*) > 1 filter.` };
      return { ok: true, msg: `✓ Correct! ${rows.length} departments shown with full headcount and salary breakdown.` };
    }
  },
  {
    id: 'p7',
    title: 'Category Sales Summary',
    difficulty: 'Hard',
    category: 'Multi-Join Analytics',
    tags: ['JOIN', 'GROUP BY', 'SUM', 'COUNT', 'AVG'],
    description: 'Summarize sales by product category. For each category show: `category`, total number of orders aliased as `order_count`, total units sold (sum of quantity) aliased as `units_sold`, and total revenue aliased as `revenue`. Sort by revenue descending.\n\nAvailable tables: `products`, `orders`',
    hint: 'JOIN orders with products on o.product_id = p.id. GROUP BY p.category. Use COUNT(*), SUM(o.quantity), SUM(o.total).',
    solutionSql: `SELECT p.category, COUNT(*) AS order_count, SUM(o.quantity) AS units_sold, SUM(o.total) AS revenue\nFROM orders o\nJOIN products p ON o.product_id = p.id\nGROUP BY p.category\nORDER BY revenue DESC;`,
    check: (rows, cols) => {
      if (!rows || rows.length === 0) return { ok: false, msg: 'No rows returned.' };
      const colsLower = cols.map(c => c.toLowerCase());
      const hasCat = colsLower.some(c => c.includes('category') || c.includes('cat'));
      const hasUnits = colsLower.some(c => c.includes('unit') || c.includes('quantity') || c.includes('qty'));
      const hasRevenue = colsLower.some(c => c.includes('revenue') || c.includes('total'));
      const hasCount = colsLower.some(c => c.includes('count') || c.includes('order'));
      if (!hasCat) return { ok: false, msg: 'Missing category column.' };
      if (!hasUnits) return { ok: false, msg: 'Missing units_sold — use SUM(o.quantity) AS units_sold.' };
      if (!hasRevenue) return { ok: false, msg: 'Missing revenue — use SUM(o.total) AS revenue.' };
      if (!hasCount) return { ok: false, msg: 'Missing order_count — use COUNT(*) AS order_count.' };
      return { ok: true, msg: `✓ Correct! ${rows.length} categories summarized by orders, units, and revenue.` };
    }
  },
  {
    id: 'p8',
    title: 'Employees Hired in 2020',
    difficulty: 'Medium',
    category: 'String Filtering',
    tags: ['WHERE', 'LIKE', 'JOIN', 'ORDER BY'],
    description: 'List all employees who were hired in **2020**. Display employee `name`, department `name` aliased as `department`, `salary`, and `hire_date`. Sort by hire_date ascending.\n\nHint: hire_date is stored as a string like `"2020-03-15"`. Use LIKE to match the year.\n\nAvailable tables: `employees`, `departments`',
    hint: "Filter with WHERE e.hire_date LIKE '2020%' to match all dates starting with 2020. JOIN with departments to get the department name.",
    solutionSql: `SELECT e.name, d.name AS department, e.salary, e.hire_date\nFROM employees e\nJOIN departments d ON e.department_id = d.id\nWHERE e.hire_date LIKE '2020%'\nORDER BY e.hire_date ASC;`,
    check: (rows, cols) => {
      if (!rows || rows.length === 0) return { ok: false, msg: "No rows returned. Try WHERE e.hire_date LIKE '2020%'." };
      if (rows.length !== 3) return { ok: false, msg: `Expected 3 employees hired in 2020, got ${rows.length}. Check your LIKE pattern.` };
      const colsLower = cols.map(c => c.toLowerCase());
      const hasDate = colsLower.some(c => c.includes('date') || c.includes('hire'));
      const hasDept = colsLower.some(c => c.includes('dept') || c.includes('department') || c.includes('name'));
      if (!hasDate) return { ok: false, msg: 'Include the hire_date column in your results.' };
      if (!hasDept) return { ok: false, msg: 'Missing department name — JOIN with departments.' };
      return { ok: true, msg: '✓ Correct! 3 employees hired in 2020: Alice, Grace, and Jake.' };
    }
  },
];

/* ══════════════════════════════════════════════════════════════
   PRACTICE TAB COMPONENT
══════════════════════════════════════════════════════════════ */
function PracticeTab({ activeDb, isMobile }) {
  const [selectedId, setSelectedId] = useState(PRACTICE_PROBLEMS[0].id);
  const [userSql, setUserSql] = useState('-- Write your SQL here\n\n');
  const [result, setResult]     = useState(null);
  const [execError, setExecError] = useState(null);
  const [checkResult, setCheckResult] = useState(null);
  const [showHint, setShowHint]       = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [completed, setCompleted] = useState(new Set());
  const [listOpen, setListOpen]   = useState(true);

  // Autocomplete state
  const [suggestions, setSuggestions] = useState([]);
  const [suggSel, setSuggSel]         = useState(0);
  const [suggAnchor, setSuggAnchor]   = useState(null);

  const taRef       = useRef(null);
  const hlRef       = useRef(null);
  const lnRef       = useRef(null);
  const suggListRef = useRef(null);

  const problem = PRACTICE_PROBLEMS.find(p => p.id === selectedId);

  // Reset when switching problems
  useEffect(() => {
    setUserSql('-- Write your SQL here\n\n');
    setResult(null);
    setExecError(null);
    setCheckResult(null);
    setShowHint(false);
    setShowSolution(false);
    setSuggestions([]);
    setSuggAnchor(null);
  }, [selectedId]);

  // Autocomplete pool — all keywords + table/col names from the DB
  const suggPool = useMemo(() => {
    const tables = activeDb?.tables || {};
    const kws  = [...SQL_KW].map(k => ({ label: k, kind: 'kw' }));
    const fns  = [...SQL_FN].map(f => ({ label: f, kind: 'fn' }));
    const tbls = Object.keys(tables).map(t => ({ label: t, kind: 'tbl' }));
    const seen = new Set();
    const cols = Object.values(tables).flatMap(t =>
      t.cols.filter(c => { if (seen.has(c)) return false; seen.add(c); return true; })
            .map(c => ({ label: c, kind: 'col' }))
    );
    return [...kws, ...fns, ...tbls, ...cols];
  }, [activeDb]);

  function computeSuggestions(ta) {
    const pos  = ta.selectionStart;
    const text = ta.value;
    let start  = pos;
    while (start > 0 && /\w/.test(text[start - 1])) start--;
    const word = text.slice(start, pos);
    if (word.length < 1) { setSuggestions([]); setSuggAnchor(null); return; }
    const wu = word.toUpperCase();
    const matches = suggPool
      .filter(s => s.label.toUpperCase().startsWith(wu) && s.label.toUpperCase() !== wu)
      .slice(0, 20);
    if (!matches.length) { setSuggestions([]); setSuggAnchor(null); return; }
    const before   = text.slice(0, start);
    const lineIdx  = text.slice(0, pos).split('\n').length - 1;
    const colInLine = before.split('\n')[before.split('\n').length - 1].length;
    const LINE_H   = 13 * 1.65;
    const CHAR_W   = 7.82;
    const PAD_TOP  = 12;
    const PAD_LEFT = 60;
    const top  = PAD_TOP + (lineIdx + 1) * LINE_H - (ta.scrollTop || 0);
    const left = PAD_LEFT + colInLine * CHAR_W;
    setSuggestions(matches);
    setSuggSel(0);
    setSuggAnchor({ top, left, wordStart: start, word });
  }

  function applySuggestion(label) {
    const ta = taRef.current;
    if (!ta || !suggAnchor) return;
    const cursorPos = ta.selectionStart;
    const before = userSql.slice(0, suggAnchor.wordStart);
    const after  = userSql.slice(cursorPos);
    const newSql = before + label + after;
    setUserSql(newSql);
    const newPos = suggAnchor.wordStart + label.length;
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos; ta.focus(); });
    setSuggestions([]); setSuggAnchor(null);
  }

  const onScroll = useCallback(() => {
    if (hlRef.current && taRef.current) {
      hlRef.current.scrollTop = taRef.current.scrollTop;
      hlRef.current.scrollLeft = taRef.current.scrollLeft;
    }
    if (lnRef.current && taRef.current) {
      lnRef.current.scrollTop = taRef.current.scrollTop;
    }
  }, []);

  const runQuery = useCallback(() => {
    setSuggestions([]); setSuggAnchor(null);
    try {
      const res  = activeDb.run(userSql);
      const last = res[res.length - 1];
      setResult(last);
      setExecError(null);
      setCheckResult(null);
    } catch(e) {
      setExecError(e.message);
      setResult(null);
    }
  }, [activeDb, userSql]);

  const checkAnswer = () => {
    if (!result) { setCheckResult({ ok: false, msg: 'Run your query first before checking.' }); return; }
    const cr = problem.check(result.rows, result.cols);
    setCheckResult(cr);
    if (cr.ok) setCompleted(c => new Set([...c, selectedId]));
  };

  const onKeyDown = useCallback((e) => {
    // Suggestions navigation
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggSel(s => { const n = Math.min(s+1, suggestions.length-1); requestAnimationFrame(()=>{ suggListRef.current?.children[n]?.scrollIntoView({block:'nearest'}); }); return n; });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggSel(s => { const n = Math.max(s-1, 0); requestAnimationFrame(()=>{ suggListRef.current?.children[n]?.scrollIntoView({block:'nearest'}); }); return n; });
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setSuggestions([]); setSuggAnchor(null); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); applySuggestion(suggestions[suggSel].label); return; }
    }
    // Ctrl+Enter → run
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runQuery(); return; }
    // Tab → 2-space indent
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = taRef.current;
      const s = ta.selectionStart, en = ta.selectionEnd;
      const nv = userSql.slice(0, s) + '  ' + userSql.slice(en);
      setUserSql(nv);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    }
    // Auto-indent on Enter
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const ta = taRef.current;
      const s = ta.selectionStart, en = ta.selectionEnd;
      const beforeCursor = userSql.slice(0, s);
      const lines = beforeCursor.split('\n');
      const currentLine = lines[lines.length - 1];
      const indentMatch = currentLine.match(/^(\s*)/);
      const currentIndent = indentMatch ? indentMatch[1] : '';
      let openCount = 0, closeCount = 0;
      for (const ch of currentLine) {
        if (['(','[','{'].includes(ch)) openCount++;
        if ([')',']','}'].includes(ch)) closeCount++;
      }
      const newIndent = currentIndent + (openCount > closeCount ? '  ' : '');
      const nv = userSql.slice(0, s) + '\n' + newIndent + userSql.slice(en);
      setUserSql(nv);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1 + newIndent.length; });
    }
    // Smart bracket deletion
    const closingMap = { '(': ')', '[': ']', '{': '}' };
    const findMatchingClosing = (text, openPos, openBracket) => {
      const closeBracket = closingMap[openBracket];
      let depth = 1;
      for (let i = openPos + 1; i < text.length; i++) {
        if (text[i] === openBracket) depth++;
        if (text[i] === closeBracket) { depth--; if (depth === 0) return i; }
      }
      return -1;
    };
    if (e.key === 'Backspace') {
      const ta = taRef.current;
      const s = ta.selectionStart;
      const charBefore = userSql[s - 1];
      if (['(','[','{'].includes(charBefore)) {
        const matchingPos = findMatchingClosing(userSql, s - 1, charBefore);
        if (matchingPos !== -1) {
          e.preventDefault();
          const nv = userSql.slice(0, s - 1) + userSql.slice(s, matchingPos) + userSql.slice(matchingPos + 1);
          setUserSql(nv);
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s - 1; });
          return;
        }
      }
    }
    if (e.key === 'Delete') {
      const ta = taRef.current;
      const s = ta.selectionStart;
      const charAt = userSql[s];
      if (['(','[','{'].includes(charAt)) {
        const matchingPos = findMatchingClosing(userSql, s, charAt);
        if (matchingPos !== -1) {
          e.preventDefault();
          const nv = userSql.slice(0, s) + userSql.slice(s + 1, matchingPos) + userSql.slice(matchingPos + 1);
          setUserSql(nv);
          requestAnimationFrame(() => { taRef.current.selectionStart = taRef.current.selectionEnd = s; });
          return;
        }
      }
    }
    // Skip over matching closing bracket
    if ([')',']','}'].includes(e.key)) {
      const ta = taRef.current;
      const s = ta.selectionStart;
      if (userSql[s] === e.key) {
        e.preventDefault();
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1; });
        return;
      }
    }
    // Auto-close brackets
    if (['(','[','{'].includes(e.key)) {
      e.preventDefault();
      const ta = taRef.current;
      const s = ta.selectionStart, en = ta.selectionEnd;
      const closing = closingMap[e.key];
      const selectedText = userSql.slice(s, en);
      const nv = userSql.slice(0, s) + e.key + selectedText + closing + userSql.slice(en);
      setUserSql(nv);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1; });
    }
  }, [userSql, suggestions, suggSel, suggAnchor, runQuery]);

  const diffColor = d => d === 'Hard' ? RED : d === 'Medium' ? AMBER : GREEN;

  const edS = {
    fontFamily: MONO, fontSize: '13px', lineHeight: '1.65',
    padding: '12px 16px 12px 60px', tabSize: 2,
    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    textAlign: 'left', letterSpacing: 'normal',
  };

  const highlighted = useMemo(() => highlight(userSql), [userSql]);
  const lineCount   = useMemo(() => userSql.split('\n').length, [userSql]);

  return (
    <div style={{display:'flex',flex:1,overflow:'hidden',flexDirection:isMobile?'column':'row'}}>

      {/* ── Problem List Sidebar ── */}
      {(!isMobile || listOpen) && (
        <aside style={{width:isMobile?'100%':220,maxHeight:isMobile?220:'none',borderRight:isMobile?'none':`1px solid ${BORDER}`,borderBottom:isMobile?`1px solid ${BORDER}`:'none',background:SURF,display:'flex',flexDirection:'column',overflow:'hidden',flexShrink:0}}>
          <div style={{padding:'0 12px',height:35,display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:`1px solid ${BORDER}`,flexShrink:0}}>
            <span style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',color:MUTED,textTransform:'uppercase',fontFamily:SANS}}>
              Problems &nbsp;<span style={{color:GREEN}}>{completed.size}/{PRACTICE_PROBLEMS.length}</span>
            </span>
            {isMobile && <button onClick={()=>setListOpen(false)} style={{background:'transparent',border:'none',color:MUTED,cursor:'pointer',fontSize:13}}>✕</button>}
          </div>
          <div style={{overflowY:'auto',flex:1}}>
            {PRACTICE_PROBLEMS.map((p, i) => (
              <div key={p.id} onClick={()=>{ setSelectedId(p.id); if(isMobile)setListOpen(false); }}
                className="schema-row"
                style={{padding:'9px 12px',cursor:'pointer',borderLeft:`2px solid ${selectedId===p.id?ACCENT:'transparent'}`,background:selectedId===p.id?`${ACCENT}15`:'transparent',transition:'background 0.1s',borderBottom:`1px solid ${BORDER}22`}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                  <span style={{fontSize:10,fontFamily:MONO,fontWeight:600,color:completed.has(p.id)?GREEN:MUTED,minWidth:16,textAlign:'left'}}>{completed.has(p.id)?'✓':`${i+1}.`}</span>
                  <span style={{fontSize:11,fontFamily:SANS,fontWeight:600,color:TEXT,flex:1,lineHeight:'1.3',textAlign:'left'}}>{p.title}</span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:5,paddingLeft:22}}>
                  <span style={{fontSize:9,fontFamily:MONO,fontWeight:700,color:diffColor(p.difficulty),padding:'1px 5px',border:`1px solid ${diffColor(p.difficulty)}44`,borderRadius:2}}>{p.difficulty}</span>
                  <span style={{fontSize:9,fontFamily:SANS,color:MUTED,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.category}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* ── Main Practice Area ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {/* Problem Header bar */}
        <div style={{padding:'0 16px',height:35,display:'flex',alignItems:'center',gap:8,borderBottom:`1px solid ${BORDER}`,background:SURF,flexShrink:0,flexWrap:'wrap'}}>
          {isMobile && !listOpen && (
            <button onClick={()=>setListOpen(true)} className="btn-hover"
              style={{padding:'3px 8px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>
              Problems
            </button>
          )}
          <span style={{fontSize:13,fontWeight:700,color:TEXT,fontFamily:SANS}}>{problem.title}</span>
          <span style={{fontSize:9,fontFamily:MONO,fontWeight:700,color:diffColor(problem.difficulty),padding:'2px 7px',border:`1px solid ${diffColor(problem.difficulty)}55`,borderRadius:2}}>{problem.difficulty}</span>
          {completed.has(problem.id) && <span style={{fontSize:11,color:GREEN,fontFamily:MONO,fontWeight:600}}>Solved</span>}
          <div style={{marginLeft:'auto',display:'flex',gap:4,flexWrap:'wrap'}}>
            {problem.tags.map(tag=>(
              <span key={tag} style={{fontSize:9,fontFamily:MONO,color:MUTED,padding:'1px 6px',background:SURF2,borderRadius:2,border:`1px solid ${BORDER}`}}>{tag}</span>
            ))}
          </div>
        </div>

        <div style={{flex:1,display:'flex',flexDirection:isMobile?'column':'row',overflow:'hidden'}}>

          {/* ── Left: Description + Editor + Results ── */}
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>

            {/* Description panel */}
            <div style={{padding:'10px 16px',borderBottom:`1px solid ${BORDER}`,background:BG,flexShrink:0,maxHeight:isMobile?130:170,overflowY:'auto'}}>
              {problem.description.split('\n').map((line, i) => {
                const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
                return (
                  <p key={i} style={{margin:'0 0 5px',fontSize:12,fontFamily:SANS,color:TEXT,lineHeight:'1.6',textAlign:'left'}}>
                    {parts.map((pt, j) => {
                      if (pt.startsWith('**') && pt.endsWith('**')) return <strong key={j} style={{color:ACCENT}}>{pt.slice(2,-2)}</strong>;
                      if (pt.startsWith('`') && pt.endsWith('`')) return <code key={j} style={{fontFamily:MONO,fontSize:11,color:AMBER,background:SURF2,padding:'1px 4px',borderRadius:2}}>{pt.slice(1,-1)}</code>;
                      return pt;
                    })}
                  </p>
                );
              })}
            </div>

            {/* Editor toolbar */}
            <div style={{display:'flex',alignItems:'center',gap:6,padding:'5px 12px',borderBottom:`1px solid ${BORDER}`,background:SURF,flexShrink:0}}>
              <span style={{fontSize:10,fontWeight:700,color:MUTED,fontFamily:SANS,textTransform:'uppercase',letterSpacing:'0.08em'}}>SQL Editor</span>
              <span style={{fontSize:10,color:MUTED,fontFamily:MONO,marginLeft:4}}>{lineCount} lines</span>
              <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}>
                <span style={{fontSize:10,color:MUTED,fontFamily:MONO}}>Ctrl+Enter to run</span>
                <button onClick={()=>{ setUserSql('-- Write your SQL here\n\n'); setSuggestions([]); }} className="btn-hover"
                  style={{padding:'3px 9px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>Clear</button>
                <button onClick={runQuery} className="btn-hover"
                  style={{padding:'3px 12px',background:BLUE,color:'#fff',border:'none',borderRadius:2,fontWeight:600,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>&#9654; Run</button>
                <button onClick={checkAnswer} className="btn-hover"
                  style={{padding:'3px 12px',background:GREEN,color:'#111',border:'none',borderRadius:2,fontWeight:600,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>Check</button>
              </div>
            </div>

            {/* Code Editor area */}
            <div style={{flex:1,position:'relative',overflow:'hidden',minHeight:isMobile?110:0}}>
              {/* Line numbers */}
              <div ref={lnRef} style={{position:'absolute',left:0,top:0,bottom:0,width:44,background:BG,borderRight:`1px solid ${BORDER}22`,overflowY:'hidden',pointerEvents:'none',zIndex:2}}>
                <div style={{...edS,padding:'12px 8px 12px 0',color:'#4E4E4E',textAlign:'right',userSelect:'none',fontSize:'13px'}}>
                  {Array.from({length:lineCount},(_,i)=>`${i+1}\n`).join('')}
                </div>
              </div>
              {/* Highlight overlay */}
              <pre ref={hlRef} aria-hidden
                style={{...edS,position:'absolute',top:0,left:0,right:0,bottom:0,margin:0,overflow:'hidden',pointerEvents:'none',zIndex:1,color:TEXT,background:BG}}
                dangerouslySetInnerHTML={{__html:highlighted+'<br/>'}}/>
              {/* Textarea */}
              <textarea ref={taRef} value={userSql}
                onChange={e=>{ setUserSql(e.target.value); computeSuggestions(e.target); }}
                onScroll={onScroll}
                onKeyDown={onKeyDown}
                onBlur={()=>setTimeout(()=>{ setSuggestions([]); setSuggAnchor(null); }, 150)}
                spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
                style={{...edS,position:'absolute',top:0,left:0,right:0,bottom:0,width:'100%',height:'100%',background:'transparent',color:'transparent',caretColor:TEXT,zIndex:3,overflowY:'auto',overflowX:'auto',resize:'none',outline:'none',border:'none'}}/>
              {/* Autocomplete dropdown */}
              {suggestions.length > 0 && suggAnchor && (
                <div style={{position:'absolute',top:suggAnchor.top,left:Math.min(suggAnchor.left, 'calc(100% - 220px)'),zIndex:20,
                  background:SURF2,border:`1px solid ${BORDER}`,borderRadius:2,overflow:'hidden',
                  boxShadow:'0 4px 16px rgba(0,0,0,0.5)',minWidth:180,maxWidth:260,pointerEvents:'all'}}>
                  <div style={{padding:'3px 8px',fontSize:10,color:MUTED,fontFamily:MONO,letterSpacing:'0.06em',borderBottom:`1px solid ${BORDER}`,background:SURF,whiteSpace:'nowrap'}}>
                    SUGGESTIONS &nbsp;<span style={{opacity:0.5}}>&#x2191;&#x2193; Tab Esc</span>
                  </div>
                  <div ref={suggListRef} style={{maxHeight:200,overflowY:'auto',overflowX:'hidden'}}>
                    {suggestions.map((s, i) => {
                      const kindColor = s.kind==='kw'?ACCENT:s.kind==='fn'?'#DCDCAA':s.kind==='tbl'?GREEN:'#9CDCFE';
                      const kindLabel = s.kind==='kw'?'kw':s.kind==='fn'?'fn':s.kind==='tbl'?'tbl':'col';
                      return (
                        <div key={i} onMouseDown={e2=>{e2.preventDefault(); applySuggestion(s.label);}}
                          style={{display:'flex',alignItems:'center',gap:6,padding:'4px 8px',cursor:'pointer',
                            background: i===suggSel ? `${ACCENT}22` : 'transparent',
                            borderLeft: `2px solid ${i===suggSel ? ACCENT : 'transparent'}`,
                            color: i===suggSel ? TEXT : MUTED}}>
                          <span style={{fontSize:9,fontFamily:MONO,fontWeight:700,color:kindColor,padding:'1px 4px',borderRadius:2,flexShrink:0,minWidth:24,textAlign:'center'}}>{kindLabel}</span>
                          <span style={{fontFamily:MONO,fontSize:12,flex:1,textAlign:'left'}}>
                            <span style={{color:ACCENT,fontWeight:700}}>{s.label.slice(0, suggAnchor.word.length)}</span>
                            {s.label.slice(suggAnchor.word.length)}
                          </span>
                          {i === suggSel && <span style={{fontSize:9,color:MUTED,flexShrink:0}}>Tab</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Check result banner */}
            {checkResult && (
              <div style={{padding:'7px 14px',borderTop:`1px solid ${BORDER}`,background:checkResult.ok?'#1a2e1a':'#2e1a1a',flexShrink:0,display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:11,fontFamily:MONO,fontWeight:700,color:checkResult.ok?GREEN:RED}}>{checkResult.ok?'PASS':'FAIL'}</span>
                <span style={{fontSize:11,fontFamily:MONO,color:checkResult.ok?GREEN:RED}}>{checkResult.msg}</span>
              </div>
            )}

            {/* Exec error banner */}
            {execError && (
              <div style={{padding:'7px 14px',borderTop:`1px solid #5C2020`,background:'#1C1414',flexShrink:0}}>
                <span style={{fontSize:11,fontFamily:MONO,color:RED,textAlign:'left',display:'block'}}>Error: {execError}</span>
              </div>
            )}

            {/* Results table */}
            {result && result.cols && (
              <div style={{borderTop:`1px solid ${BORDER}`,flex:'0 0 auto',maxHeight:190,overflowY:'auto',overflowX:'auto',flexShrink:0}}>
                <div style={{padding:'4px 12px 3px',fontSize:10,fontWeight:700,color:MUTED,fontFamily:SANS,textTransform:'uppercase',letterSpacing:'0.08em',borderBottom:`1px solid ${BORDER}`,background:SURF,display:'flex',alignItems:'center',gap:8}}>
                  <span>Results</span>
                  <span style={{color:GREEN,fontFamily:MONO,fontSize:11}}>{result.rows.length} rows</span>
                </div>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:11,fontFamily:MONO}}>
                  <thead>
                    <tr>
                      {result.cols.map(col=>(
                        <th key={col} style={{padding:'4px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:ACCENT,textTransform:'uppercase',letterSpacing:'0.06em',borderBottom:`1px solid ${BORDER}`,background:SURF2,whiteSpace:'nowrap'}}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0,50).map((row,ri)=>(
                      <tr key={ri} className="row-hover" style={{borderBottom:`1px solid ${BORDER}22`,background:ri%2===0?'transparent':'rgba(255,255,255,0.02)'}}>
                        {row.map((cell,ci)=>(
                          <td key={ci} style={{padding:'4px 10px',color:cell==null?MUTED:typeof cell==='number'?GREEN:TEXT,whiteSpace:'nowrap',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',textAlign:'left'}}>
                            {cell==null?<span style={{fontStyle:'italic',color:MUTED}}>NULL</span>:String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Right panel: Hint + Solution + Schema + Nav ── */}
          <div style={{width:isMobile?'100%':240,borderLeft:isMobile?'none':`1px solid ${BORDER}`,borderTop:isMobile?`1px solid ${BORDER}`:'none',background:SURF,display:'flex',flexDirection:'column',overflow:'hidden',flexShrink:0}}>

            {/* Hint */}
            <div style={{borderBottom:`1px solid ${BORDER}`,flexShrink:0}}>
              <button onClick={()=>setShowHint(h=>!h)} className="btn-hover"
                style={{width:'100%',padding:'8px 14px',background:'transparent',border:'none',display:'flex',alignItems:'center',gap:8,cursor:'pointer',textAlign:'left'}}>
                <span style={{fontSize:12,color:MUTED}}>{showHint?'▾':'▸'}</span>
                <span style={{fontSize:11,fontWeight:700,color:AMBER,fontFamily:SANS}}>Hint</span>
              </button>
              {showHint && (
                <div style={{padding:'6px 14px 12px',borderTop:`1px solid ${BORDER}22`}}>
                  <p style={{margin:0,fontSize:11,fontFamily:SANS,color:TEXT,lineHeight:'1.6',textAlign:'left'}}>{problem.hint}</p>
                </div>
              )}
            </div>

            {/* Solution */}
            <div style={{borderBottom:`1px solid ${BORDER}`,flexShrink:0}}>
              <button onClick={()=>setShowSolution(s=>!s)} className="btn-hover"
                style={{width:'100%',padding:'8px 14px',background:'transparent',border:'none',display:'flex',alignItems:'center',gap:8,cursor:'pointer',textAlign:'left'}}>
                <span style={{fontSize:12,color:MUTED}}>{showSolution?'▾':'▸'}</span>
                <span style={{fontSize:11,fontWeight:700,color:MUTED,fontFamily:SANS}}>Show Solution</span>
              </button>
              {showSolution && (
                <div style={{borderTop:`1px solid ${BORDER}22`}}>
                  <div style={{padding:'4px 8px',display:'flex',justifyContent:'flex-end'}}>
                    <button onClick={()=>setUserSql(problem.solutionSql)} className="btn-hover"
                      style={{padding:'2px 8px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:10,fontFamily:SANS,cursor:'pointer'}}>Use in Editor</button>
                  </div>
                  <pre style={{margin:0,padding:'4px 12px 12px',background:BG,fontSize:10,fontFamily:MONO,lineHeight:'1.65',overflowX:'auto',color:TEXT,textAlign:'left'}} dangerouslySetInnerHTML={{__html:highlight(problem.solutionSql)}}/>
                </div>
              )}
            </div>

            {/* Schema reference */}
            <div style={{flex:1,overflowY:'auto'}}>
              <div style={{padding:'8px 14px 4px',fontSize:10,fontWeight:700,color:MUTED,textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:SANS,textAlign:'left'}}>Schema Reference</div>
              {[
                {name:'employees',  cols:['id','name','department_id','salary','hire_date']},
                {name:'departments',cols:['id','name','location']},
                {name:'products',   cols:['id','name','category','price','stock']},
                {name:'orders',     cols:['id','product_id','quantity','total','order_date']},
              ].map(tbl=>(
                <div key={tbl.name} style={{padding:'4px 14px 8px'}}>
                  <div style={{fontSize:11,fontFamily:MONO,fontWeight:600,color:ACCENT,marginBottom:3,textAlign:'left'}}>{tbl.name}</div>
                  {tbl.cols.map(col=>(
                    <div key={col} style={{fontSize:10,fontFamily:MONO,color:MUTED,paddingLeft:10,lineHeight:'1.7',textAlign:'left'}}>— {col}</div>
                  ))}
                </div>
              ))}
            </div>

            {/* Prev / Next navigation */}
            <div style={{padding:'8px 10px',borderTop:`1px solid ${BORDER}`,display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
              {(() => {
                const idx  = PRACTICE_PROBLEMS.findIndex(p => p.id === selectedId);
                const prev = PRACTICE_PROBLEMS[idx - 1];
                const next = PRACTICE_PROBLEMS[idx + 1];
                return (<>
                  <button onClick={()=>prev&&setSelectedId(prev.id)} disabled={!prev} className="btn-hover"
                    style={{padding:'4px 10px',background:'transparent',border:`1px solid ${prev?BORDER:'transparent'}`,borderRadius:2,color:prev?MUTED:BORDER,fontSize:11,fontFamily:SANS,cursor:prev?'pointer':'default'}}>&#8592; Prev</button>
                  <span style={{fontSize:10,color:MUTED,fontFamily:MONO}}>{idx+1}/{PRACTICE_PROBLEMS.length}</span>
                  <button onClick={()=>next&&setSelectedId(next.id)} disabled={!next} className="btn-hover"
                    style={{padding:'4px 10px',background:'transparent',border:`1px solid ${next?BORDER:'transparent'}`,borderRadius:2,color:next?MUTED:BORDER,fontSize:11,fontFamily:SANS,cursor:next?'pointer':'default'}}>Next &#8594;</button>
                </>);
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   THEME — declared here so ERDiagram & all components can use them
══════════════════════════════════════════════════════════════ */
const MONO = "'JetBrains Mono','Cascadia Code','Fira Code','Consolas','Courier New',monospace";
const SANS = "'Segoe UI','SF Pro Text',system-ui,sans-serif";
const BG='#1E1E1E',SURF='#252526',SURF2='#2D2D30',BORDER='#3C3C3C',TEXT='#D4D4D4',MUTED='#858585';
const AMBER='#CE9178',GREEN='#4EC9B0',RED='#F44747',BLUE='#007ACC',ACCENT='#569CD6';

/* ══════════════════════════════════════════════════════════════
   CHART HELPER
══════════════════════════════════════════════════════════════ */
const CHART_COLORS = [ACCENT,'#10B981',AMBER,'#EF4444','#8B5CF6','#EC4899'];
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
   ER DIAGRAM HELPERS
══════════════════════════════════════════════════════════════ */
function detectRelationships(schema) {
  const rels = [];
  const tableNames = Object.keys(schema);
  for (const [tname, tbl] of Object.entries(schema)) {
    for (const col of tbl.cols) {
      if (col.endsWith('_id') && col !== 'id') {
        const prefix = col.slice(0, -3);
        const target = tableNames.find(t => t === prefix || t === prefix + 's' || t === prefix + 'es' || t.startsWith(prefix));
        if (target && target !== tname) {
          rels.push({ fromTable: tname, fromCol: col, toTable: target, toCol: 'id', color: '' });
        }
      }
    }
  }
  const palette = ['#F59E0B','#3B82F6','#10B981','#EF4444','#8B5CF6','#EC4899','#06B6D4'];
  rels.forEach((r, i) => { r.color = palette[i % palette.length]; });
  return rels;
}

function inferColType(tbl, col, colIdx) {
  if (col === 'id' || col.endsWith('_id')) return 'int';
  const vals = tbl.rows.slice(0, 8).map(r => r[colIdx]).filter(v => v != null);
  if (!vals.length) return 'text';
  if (vals.every(v => typeof v === 'number' && Number.isInteger(v))) return 'int';
  if (vals.every(v => typeof v === 'number')) return 'decimal';
  if (vals.every(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))) return 'date';
  const maxLen = Math.max(...vals.map(v => String(v).length));
  if (vals.every(v => typeof v === 'string') && maxLen <= 2) return 'char(2)';
  if (vals.every(v => typeof v === 'string')) return `varchar(${Math.min(255, maxLen * 2 + 20)})`;
  return 'text';
}

const TABLE_W = 230;
const HEADER_H = 38;
const COL_ROW_H = 26;
const TABLE_PAD_B = 8;

function ERDiagram({ schema, schemaVer }) {
  const tableNames = Object.keys(schema);
  const [positions, setPositions] = useState(() => {
    const pos = {};
    const cols = Math.max(2, Math.ceil(Math.sqrt(tableNames.length)));
    tableNames.forEach((t, i) => {
      pos[t] = { x: 60 + (i % cols) * 310, y: 60 + Math.floor(i / cols) * 320 };
    });
    return pos;
  });
  const [dragging, setDragging] = useState(null); // { tname, ox, oy }
  const containerRef = useRef(null);
  const relationships = useMemo(() => detectRelationships(schema), [schemaVer]);

  // Reset layout when tables change
  useEffect(() => {
    const names = Object.keys(schema);
    setPositions(prev => {
      const next = { ...prev };
      const cols = Math.max(2, Math.ceil(Math.sqrt(names.length)));
      names.forEach((t, i) => {
        if (!next[t]) next[t] = { x: 60 + (i % cols) * 310, y: 60 + Math.floor(i / cols) * 320 };
      });
      Object.keys(next).forEach(k => { if (!schema[k]) delete next[k]; });
      return next;
    });
  }, [schemaVer]);

  const onMouseDown = useCallback((e, tname) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    setDragging({ tname, ox: e.clientX - rect.left - positions[tname].x, oy: e.clientY - rect.top - positions[tname].y });
  }, [positions]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, e.clientX - rect.left - dragging.ox);
      const y = Math.max(0, e.clientY - rect.top - dragging.oy);
      setPositions(p => ({ ...p, [dragging.tname]: { x, y } }));
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  function tblH(tname) { return HEADER_H + (schema[tname]?.cols.length || 0) * COL_ROW_H + TABLE_PAD_B; }

  function connPt(tname, colName, prefer) {
    const pos = positions[tname] || { x: 0, y: 0 };
    const tbl = schema[tname];
    if (!tbl) return { x: pos.x, y: pos.y };
    const colIdx = tbl.cols.indexOf(colName);
    const y = pos.y + HEADER_H + colIdx * COL_ROW_H + COL_ROW_H / 2;
    return { x: prefer === 'right' ? pos.x + TABLE_W : pos.x, y };
  }

  // Compute SVG canvas size
  const canvasW = Math.max(900, ...tableNames.map(t => (positions[t]?.x || 0) + TABLE_W + 80));
  const canvasH = Math.max(600, ...tableNames.map(t => (positions[t]?.y || 0) + tblH(t) + 80));

  const fkSet = new Set(relationships.map(r => `${r.fromTable}.${r.fromCol}`));
  const pkSet = new Set(tableNames.map(t => `${t}.id`));

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'auto', background: BG, cursor: dragging ? 'grabbing' : 'default' }}>
      {/* SVG connection layer */}
      <svg style={{ position: 'absolute', top: 0, left: 0, width: canvasW, height: canvasH, pointerEvents: 'none', zIndex: 0 }}>
        <defs>
          {relationships.map((rel, i) => (
            <marker key={i} id={`arrow-${i}`} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill={rel.color} opacity="0.9"/>
            </marker>
          ))}
        </defs>
        {relationships.map((rel, i) => {
          const fp = positions[rel.fromTable], tp = positions[rel.toTable];
          if (!fp || !tp) return null;
          // Decide side based on relative position
          const fromRight = fp.x + TABLE_W / 2 < tp.x + TABLE_W / 2;
          const from = connPt(rel.fromTable, rel.fromCol, fromRight ? 'right' : 'left');
          const to = connPt(rel.toTable, rel.toCol, fromRight ? 'left' : 'right');
          const bend = Math.min(120, Math.abs(from.x - to.x) * 0.5 + 40);
          const cp1x = from.x + (fromRight ? bend : -bend);
          const cp2x = to.x + (fromRight ? -bend : bend);
          return (
            <g key={i}>
              <path d={`M${from.x},${from.y} C${cp1x},${from.y} ${cp2x},${to.y} ${to.x},${to.y}`}
                stroke={rel.color} strokeWidth={2.5} fill="none" opacity={0.85} markerEnd={`url(#arrow-${i})`}/>
              {/* FK dot */}
              <circle cx={from.x} cy={from.y} r={5} fill={rel.color} opacity={0.9}/>
              {/* PK double ring */}
              <circle cx={to.x} cy={to.y} r={7} fill="none" stroke={rel.color} strokeWidth={2} opacity={0.8}/>
              <circle cx={to.x} cy={to.y} r={3.5} fill={rel.color} opacity={0.9}/>
            </g>
          );
        })}
      </svg>

      {/* Table boxes */}
      {tableNames.map(tname => {
        const tbl = schema[tname];
        const pos = positions[tname] || { x: 0, y: 0 };
        const relColors = {};
        relationships.filter(r => r.fromTable === tname).forEach(r => { relColors[r.fromCol] = r.color; });
        const isDragging = dragging?.tname === tname;

        return (
          <div key={tname + schemaVer} style={{
            position: 'absolute', left: pos.x, top: pos.y, width: TABLE_W, zIndex: isDragging ? 100 : 1,
            borderRadius: 4, overflow: 'hidden', border: `1px solid ${isDragging ? ACCENT : BORDER}`,
            boxShadow: isDragging ? `0 8px 24px rgba(0,0,0,0.6)` : '0 2px 8px rgba(0,0,0,0.4)',
            transition: isDragging ? 'none' : 'box-shadow 0.2s',
          }}>
            {/* Header */}
            <div onMouseDown={e => onMouseDown(e, tname)}
              style={{ background: '#37373D', padding: '0 12px', height: HEADER_H, display: 'flex', alignItems: 'center', gap: 8, cursor: 'grab', userSelect: 'none', borderBottom: `1px solid ${BORDER}` }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{flexShrink:0}}>
                <rect x="1" y="2" width="14" height="12" rx="1" stroke={ACCENT} strokeWidth="1.4" fill="none"/>
                <line x1="1" y1="6" x2="15" y2="6" stroke={ACCENT} strokeWidth="1"/>
                <line x1="5" y1="2" x2="5" y2="14" stroke={ACCENT} strokeWidth="1"/>
              </svg>
              <span style={{ fontSize: 12, fontWeight: 600, color: TEXT, fontFamily: MONO }}>{tname}</span>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: MUTED, fontFamily: MONO }}>{tbl.rows.length} rows</span>
            </div>
            {/* Column rows */}
            {tbl.cols.map((col, ci) => {
              const isFK = fkSet.has(`${tname}.${col}`);
              const isPK = pkSet.has(`${tname}.${col}`);
              const colColor = isPK ? AMBER : isFK ? (relColors[col] || '#3B82F6') : '#7D8590';
              const colType = inferColType(tbl, col, ci);
              return (
                <div key={col} style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: `0 10px`,
                  height: COL_ROW_H, background: ci % 2 === 0 ? SURF : SURF2,
                  borderTop: `1px solid ${BORDER}`,
                }}>
                  <span style={{ fontSize: 9, color: colColor, lineHeight: 1, flexShrink: 0, fontFamily: MONO, fontWeight: 700, minWidth: 16 }}>
                    {isPK ? 'PK' : isFK ? 'FK' : ''}
                  </span>
                  <span style={{ fontSize: 11, fontFamily: MONO, color: isPK ? ACCENT : isFK ? (relColors[col] || ACCENT) : TEXT, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{col}</span>
                  <span style={{ fontSize: 10, fontFamily: MONO, color: MUTED, flexShrink: 0, textAlign: 'right' }}>{colType}</span>
                </div>
              );
            })}
            <div style={{ height: TABLE_PAD_B, background: SURF }}/>
          </div>
        );
      })}

      {/* Legend */}
      <div style={{ position: 'fixed', bottom: 32, right: 24, background: SURF2, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '10px 14px', zIndex: 200, minWidth: 160 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: SANS }}>Legend</div>
        {[{ label: 'Primary Key', color: ACCENT, tag: 'PK' }, { label: 'Foreign Key', color: AMBER, tag: 'FK' }, { label: 'Column', color: MUTED, tag: '' }].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{ fontSize: 9, fontFamily: MONO, fontWeight: 700, color: l.color, minWidth: 18 }}>{l.tag}</span>
            <span style={{ fontSize: 11, fontFamily: MONO, color: l.color }}>{l.label}</span>
          </div>
        ))}
        <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 8, paddingTop: 8 }}>
          {relationships.map((rel, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ width: 18, height: 2, background: rel.color, borderRadius: 1, flexShrink: 0 }}/>
              <span style={{ fontSize: 10, fontFamily: MONO, color: TEXT }}>{rel.fromTable}.{rel.fromCol} → {rel.toTable}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 6, fontSize: 10, color: MUTED, fontFamily: SANS }}>Drag tables to reposition</div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   FOLDER / WORKSPACE SYSTEM
══════════════════════════════════════════════════════════════ */
let folderIdCounter = 1;
function makeFolder(name, seeded = false) {
  const db = new Database();
  if (!seeded) db.tables = {};
  return { id: folderIdCounter++, name, db, expanded: true };
}

/* ══════════════════════════════════════════════════════════════
   TABLE BUILDER COMPONENT
══════════════════════════════════════════════════════════════ */
const COL_TYPES = ['INT','BIGINT','SMALLINT','TINYINT','DECIMAL','FLOAT','DOUBLE','VARCHAR','CHAR','TEXT','MEDIUMTEXT','LONGTEXT','BLOB','DATE','DATETIME','TIMESTAMP','TIME','BOOLEAN','JSON','UUID'];
const COL_DEFAULTS = ['None','NULL','CURRENT_TIMESTAMP','0','1','""','Custom...'];
const COL_INDEXES = ['---','PRIMARY','UNIQUE','INDEX','FULLTEXT'];

function makeCol() {
  return { id: Date.now()+Math.random(), name:'', type:'VARCHAR', length:'255', defaultVal:'None', nullable:true, index:'---', autoInc:false, comment:'' };
}

function TableBuilder({ onRunSQL, onSendToEditor }) {
  const [tableName, setTableName] = useState('new_table');
  const [cols, setCols] = useState([makeCol(), makeCol(), makeCol()]);
  const [ifNotExists, setIfNotExists] = useState(true);
  const [customDefaults, setCustomDefaults] = useState({});
  const [previewOpen, setPreviewOpen] = useState(true);

  function updateCol(id, patch) {
    setCols(cs => cs.map(c => c.id === id ? {...c,...patch} : c));
  }
  function addCol() { setCols(cs => [...cs, makeCol()]); }
  function removeCol(id) { setCols(cs => cs.filter(c => c.id !== id)); }
  function moveCol(id, dir) {
    setCols(cs => {
      const i = cs.findIndex(c => c.id === id);
      const j = i + dir;
      if (j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function needsLength(type) { return ['VARCHAR','CHAR','DECIMAL','FLOAT','DOUBLE'].includes(type); }

  function buildSQL() {
    const name = tableName.trim() || 'new_table';
    const ine = ifNotExists ? 'IF NOT EXISTS ' : '';
    const colDefs = cols.map(c => {
      if (!c.name.trim()) return null;
      let def = `  \`${c.name.trim()}\` ${c.type}`;
      if (needsLength(c.type) && c.length) def += `(${c.length})`;
      if (c.autoInc) def += ' AUTO_INCREMENT';
      if (!c.nullable) def += ' NOT NULL';
      const dv = c.defaultVal === 'Custom...' ? (customDefaults[c.id]||'') : c.defaultVal;
      if (dv && dv !== 'None') def += ` DEFAULT ${dv === 'NULL' ? 'NULL' : dv === 'CURRENT_TIMESTAMP' ? 'CURRENT_TIMESTAMP' : `'${dv}'`}`;
      if (c.comment.trim()) def += ` COMMENT '${c.comment.trim()}'`;
      return def;
    }).filter(Boolean);

    const constraints = [];
    const pkCols = cols.filter(c => c.index === 'PRIMARY' && c.name.trim());
    if (pkCols.length) constraints.push(`  PRIMARY KEY (${pkCols.map(c=>`\`${c.name}\``).join(', ')})`);
    cols.filter(c => c.index === 'UNIQUE' && c.name.trim()).forEach(c => {
      constraints.push(`  UNIQUE KEY \`uq_${c.name}\` (\`${c.name}\`)`);
    });
    cols.filter(c => c.index === 'INDEX' && c.name.trim()).forEach(c => {
      constraints.push(`  INDEX \`idx_${c.name}\` (\`${c.name}\`)`);
    });

    const all = [...colDefs, ...constraints];
    if (!all.length) return `-- Add column names to generate SQL`;
    return `CREATE TABLE ${ine}\`${name}\` (\n${all.join(',\n')}\n);`;
  }

  const generatedSQL = buildSQL();

  const inputStyle = {
    background: SURF2, border: `1px solid ${BORDER}`, borderRadius: 2,
    color: TEXT, fontFamily: MONO, fontSize: 11, padding: '3px 6px',
    outline: 'none', width: '100%',
  };
  const selectStyle = { ...inputStyle, cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none' };
  const thStyle = {
    padding: '6px 8px', fontSize: 10, fontWeight: 700, color: MUTED,
    textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'left',
    borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap', fontFamily: SANS,
    background: SURF2, userSelect: 'none',
  };

  return (
    <div style={{display:'flex',flex:1,overflow:'hidden',flexDirection:'column'}}>
      {/* Toolbar */}
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 14px',borderBottom:`1px solid ${BORDER}`,background:SURF,flexShrink:0}}>
        <span style={{fontSize:11,color:MUTED,fontFamily:SANS,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em'}}>Table Builder</span>
        <div style={{display:'flex',alignItems:'center',gap:6,marginLeft:8}}>
          <span style={{fontSize:11,color:MUTED,fontFamily:SANS}}>Table name:</span>
          <input value={tableName} onChange={e=>setTableName(e.target.value)}
            style={{...inputStyle, width:160, fontSize:12}}
            placeholder="table_name" spellCheck={false}/>
        </div>
        <label style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:MUTED,fontFamily:SANS,cursor:'pointer',userSelect:'none'}}>
          <input type="checkbox" checked={ifNotExists} onChange={e=>setIfNotExists(e.target.checked)} style={{accentColor:ACCENT}}/>
          IF NOT EXISTS
        </label>
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          <button onClick={()=>setPreviewOpen(p=>!p)} className="btn-hover"
            style={{padding:'4px 10px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>
            {previewOpen ? 'Hide SQL' : 'Show SQL'}
          </button>
          <button onClick={()=>onSendToEditor(generatedSQL)} className="btn-hover"
            style={{padding:'4px 10px',background:'transparent',border:`1px solid ${ACCENT}`,borderRadius:2,color:ACCENT,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>
            Send to Editor
          </button>
          <button onClick={()=>onRunSQL(generatedSQL)} className="btn-hover"
            style={{padding:'4px 12px',background:BLUE,border:'none',borderRadius:2,color:'#fff',fontSize:11,fontFamily:SANS,cursor:'pointer',fontWeight:600}}>
            ▶ Run
          </button>
        </div>
      </div>

      <div style={{flex:1,display:'flex',overflow:'hidden'}}>
        {/* Column Editor */}
        <div style={{flex:1,overflowY:'auto',overflowX:'auto'}}>
          {/* Add column button row */}
          <div style={{padding:'8px 14px',borderBottom:`1px solid ${BORDER}`,display:'flex',alignItems:'center',gap:8}}>
            <button onClick={addCol} className="btn-hover"
              style={{padding:'4px 12px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>
              + Add Column
            </button>
            <span style={{fontSize:11,color:MUTED,fontFamily:MONO}}>{cols.length} column{cols.length!==1?'s':''}</span>
          </div>

          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,fontFamily:MONO}}>
            <thead>
              <tr>
                <th style={{...thStyle,width:28}}></th>
                <th style={{...thStyle,minWidth:130}}>Name</th>
                <th style={{...thStyle,width:120}}>Type</th>
                <th style={{...thStyle,width:80}}>Length</th>
                <th style={{...thStyle,width:130}}>Default</th>
                <th style={{...thStyle,width:60,textAlign:'center'}}>Null</th>
                <th style={{...thStyle,width:90}}>Index</th>
                <th style={{...thStyle,width:60,textAlign:'center'}}>A_I</th>
                <th style={{...thStyle,minWidth:140}}>Comment</th>
                <th style={{...thStyle,width:56,textAlign:'center'}}>Move</th>
                <th style={{...thStyle,width:36}}></th>
              </tr>
            </thead>
            <tbody>
              {cols.map((col, ci) => (
                <tr key={col.id} style={{borderBottom:`1px solid ${BORDER}22`, background: ci%2===0?'transparent':'rgba(255,255,255,0.02)'}}>
                  {/* Row number */}
                  <td style={{padding:'6px 8px',color:MUTED,fontSize:10,textAlign:'center',verticalAlign:'middle'}}>{ci+1}</td>

                  {/* Name */}
                  <td style={{padding:'4px 6px',verticalAlign:'middle'}}>
                    <input value={col.name} onChange={e=>updateCol(col.id,{name:e.target.value})}
                      style={inputStyle} placeholder={`column_${ci+1}`} spellCheck={false}/>
                  </td>

                  {/* Type */}
                  <td style={{padding:'4px 6px',verticalAlign:'middle'}}>
                    <div style={{position:'relative'}}>
                      <select value={col.type} onChange={e=>updateCol(col.id,{type:e.target.value,length:needsLength(e.target.value)?col.length:''})}
                        style={selectStyle}>
                        {COL_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                      <span style={{position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',color:MUTED,fontSize:9,pointerEvents:'none'}}>▾</span>
                    </div>
                  </td>

                  {/* Length */}
                  <td style={{padding:'4px 6px',verticalAlign:'middle'}}>
                    {needsLength(col.type)
                      ? <input value={col.length} onChange={e=>updateCol(col.id,{length:e.target.value})}
                          style={inputStyle} placeholder="255" spellCheck={false}/>
                      : <span style={{color:MUTED,fontSize:10,padding:'0 4px'}}>—</span>
                    }
                  </td>

                  {/* Default */}
                  <td style={{padding:'4px 6px',verticalAlign:'middle'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                      <div style={{position:'relative'}}>
                        <select value={col.defaultVal} onChange={e=>updateCol(col.id,{defaultVal:e.target.value})}
                          style={selectStyle}>
                          {COL_DEFAULTS.map(d=><option key={d} value={d}>{d}</option>)}
                        </select>
                        <span style={{position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',color:MUTED,fontSize:9,pointerEvents:'none'}}>▾</span>
                      </div>
                      {col.defaultVal==='Custom...'&&(
                        <input value={customDefaults[col.id]||''} onChange={e=>setCustomDefaults(d=>({...d,[col.id]:e.target.value}))}
                          style={{...inputStyle,fontSize:10}} placeholder="value" spellCheck={false}/>
                      )}
                    </div>
                  </td>

                  {/* Nullable */}
                  <td style={{padding:'4px 6px',textAlign:'center',verticalAlign:'middle'}}>
                    <input type="checkbox" checked={col.nullable} onChange={e=>updateCol(col.id,{nullable:e.target.checked})}
                      style={{accentColor:ACCENT,width:13,height:13,cursor:'pointer'}}/>
                  </td>

                  {/* Index */}
                  <td style={{padding:'4px 6px',verticalAlign:'middle'}}>
                    <div style={{position:'relative'}}>
                      <select value={col.index} onChange={e=>updateCol(col.id,{index:e.target.value})}
                        style={{...selectStyle,color:col.index!=='---'?ACCENT:MUTED}}>
                        {COL_INDEXES.map(ix=><option key={ix} value={ix}>{ix}</option>)}
                      </select>
                      <span style={{position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',color:MUTED,fontSize:9,pointerEvents:'none'}}>▾</span>
                    </div>
                  </td>

                  {/* Auto increment */}
                  <td style={{padding:'4px 6px',textAlign:'center',verticalAlign:'middle'}}>
                    <input type="checkbox" checked={col.autoInc} onChange={e=>updateCol(col.id,{autoInc:e.target.checked})}
                      disabled={!['INT','BIGINT','SMALLINT','TINYINT'].includes(col.type)}
                      style={{accentColor:ACCENT,width:13,height:13,cursor:'pointer',opacity:['INT','BIGINT','SMALLINT','TINYINT'].includes(col.type)?1:0.25}}/>
                  </td>

                  {/* Comment */}
                  <td style={{padding:'4px 6px',verticalAlign:'middle'}}>
                    <input value={col.comment} onChange={e=>updateCol(col.id,{comment:e.target.value})}
                      style={inputStyle} placeholder="optional comment" spellCheck={false}/>
                  </td>

                  {/* Move up/down */}
                  <td style={{padding:'4px 2px',textAlign:'center',verticalAlign:'middle'}}>
                    <button onClick={()=>moveCol(col.id,-1)} disabled={ci===0} className="btn-hover"
                      style={{background:'none',border:'none',color:ci===0?BORDER:MUTED,cursor:ci===0?'default':'pointer',fontSize:11,padding:'1px 4px',lineHeight:1}}>▴</button>
                    <button onClick={()=>moveCol(col.id,1)} disabled={ci===cols.length-1} className="btn-hover"
                      style={{background:'none',border:'none',color:ci===cols.length-1?BORDER:MUTED,cursor:ci===cols.length-1?'default':'pointer',fontSize:11,padding:'1px 4px',lineHeight:1}}>▾</button>
                  </td>

                  {/* Remove */}
                  <td style={{padding:'4px 6px',textAlign:'center',verticalAlign:'middle'}}>
                    <button onClick={()=>removeCol(col.id)} className="btn-hover"
                      style={{background:'none',border:'none',color:MUTED,cursor:'pointer',fontSize:13,padding:'1px 4px',lineHeight:1}}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Add row button at bottom */}
          <div style={{padding:'10px 14px'}}>
            <button onClick={addCol} className="btn-hover"
              style={{padding:'5px 14px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>
              + Add Column
            </button>
          </div>
        </div>

        {/* SQL Preview Panel */}
        {previewOpen && (
          <div style={{width:340,borderLeft:`1px solid ${BORDER}`,display:'flex',flexDirection:'column',flexShrink:0}}>
            <div style={{padding:'6px 12px',borderBottom:`1px solid ${BORDER}`,background:SURF,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:10,fontWeight:700,color:MUTED,textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:SANS}}>SQL Preview</span>
              <button onClick={()=>navigator.clipboard?.writeText(generatedSQL)} className="btn-hover"
                style={{padding:'2px 8px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:10,fontFamily:SANS,cursor:'pointer'}}>
                Copy
              </button>
            </div>
            <pre style={{flex:1,margin:0,padding:'12px 14px',background:BG,fontSize:12,fontFamily:MONO,lineHeight:'1.7',overflowY:'auto',overflowX:'auto',color:TEXT,whiteSpace:'pre-wrap',wordBreak:'break-all'}}
              dangerouslySetInnerHTML={{__html:highlight(generatedSQL)}}/>
          </div>
        )}
      </div>
    </div>
  );
}


const DEFAULT_SQL = `-- SQL Codelab · Tables: employees, departments, products, orders
-- Press Run or Ctrl+Enter to execute

SELECT
  e.name,
  d.name AS department,
  e.salary
FROM employees e
JOIN departments d ON e.department_id = d.id
WHERE e.salary > 80000
ORDER BY e.salary DESC;`;

let editorCounter = 1;
function makeEditor(sql = DEFAULT_SQL) {
  return { id: Date.now() + Math.random(), name: `Query ${editorCounter++}`, sql, results: null, execErr: null, lintErrors: [] };
}

export default function SQLCodelab() {
  const [tab, setTab] = useState('editor');
  // ── Multi-editor tabs ──
  const [editors, setEditors] = useState(() => [makeEditor()]);
  const [activeId, setActiveId] = useState(() => editors[0]?.id);
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState('');

  const [resultView, setResultView] = useState('table');
  const [cookCat, setCookCat] = useState('basics');
  const [cookSidebarOpen, setCookSidebarOpen] = useState(true);

  // ── Mobile detection ──
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [schemaVer, setSchemaVer] = useState(0);
  const [expandedTbls, setExpandedTbls] = useState(new Set(['employees','departments']));
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [copiedSnippet, setCopiedSnippet] = useState(null);

  // ── Autocomplete ──
  const [suggestions, setSuggestions] = useState([]);
  const [suggSel, setSuggSel] = useState(0);
  const [suggAnchor, setSuggAnchor] = useState(null);

  // ── Sidebar ──
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(210);
  const sidebarDrag = useRef(null);

  // ── Results panel ──
  const [resultsOpen, setResultsOpen] = useState(true);
  const [resultsHeight, setResultsHeight] = useState(42); // percent
  const resultsDrag = useRef(null);

  // ── Folder / Workspace system ──
  const foldersRef = useRef([makeFolder('Default DB', true)]);
  const [activeFolderId, setActiveFolderId] = useState(() => foldersRef.current[0].id);
  const [folderVer, setFolderVer] = useState(0);
  const [renamingFolderId, setRenamingFolderId] = useState(null);
  const [folderRenameVal, setFolderRenameVal] = useState('');
  const [expandedFolderIds, setExpandedFolderIds] = useState(() => new Set([foldersRef.current[0].id]));
  const taRef = useRef(null);
  const hlRef = useRef(null);
  const lnRef = useRef(null);
  const suggListRef = useRef(null);

  // ── Active folder / db ──
  const getActiveFolder = () => foldersRef.current.find(f => f.id === activeFolderId) || foldersRef.current[0];
  const activeDb = getActiveFolder()?.db;

  // Active editor shorthand
  const activeEditor = editors.find(e => e.id === activeId) || editors[0];
  const sql = activeEditor?.sql || '';

  function updateActive(patch) {
    setEditors(eds => eds.map(e => e.id === activeId ? { ...e, ...patch } : e));
  }
  function setSQL(v) { updateActive({ sql: v }); }

  // ── Sidebar resize ──
  const startSidebarDrag = useCallback((e) => {
    e.preventDefault();
    sidebarDrag.current = { startX: e.clientX, startW: sidebarWidth };
    const onMove = (ev) => {
      const delta = ev.clientX - sidebarDrag.current.startX;
      setSidebarWidth(Math.max(140, Math.min(400, sidebarDrag.current.startW + delta)));
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  // ── Results resize ──
  const startResultsDrag = useCallback((e) => {
    e.preventDefault();
    const container = e.currentTarget.closest('[data-editor-container]');
    if (!container) return;
    const totalH = container.getBoundingClientRect().height;
    resultsDrag.current = { startY: e.clientY, startPct: resultsHeight, totalH };
    const onMove = (ev) => {
      const delta = ev.clientY - resultsDrag.current.startY;
      const deltaPct = (delta / resultsDrag.current.totalH) * 100;
      setResultsHeight(Math.max(15, Math.min(75, resultsDrag.current.startPct - deltaPct)));
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [resultsHeight]);

  const onScroll = useCallback(() => {
    if(hlRef.current&&taRef.current){hlRef.current.scrollTop=taRef.current.scrollTop;hlRef.current.scrollLeft=taRef.current.scrollLeft;}
    if(lnRef.current&&taRef.current){lnRef.current.scrollTop=taRef.current.scrollTop;}
  }, []);

  useEffect(() => {
    const t=setTimeout(()=>{try{updateActive({lintErrors:lint(sql)});}catch{updateActive({lintErrors:[]});}},400);
    return()=>clearTimeout(t);
  }, [sql, activeId]);

  const highlighted = useMemo(() => highlight(sql), [sql]);
  const lineCount = useMemo(() => sql.split('\n').length, [sql]);
  const lintErrors = activeEditor?.lintErrors || [];

  const run = useCallback(() => {
    setSortCol(null);
    const aDb = (foldersRef.current.find(f => f.id === activeFolderId) || foldersRef.current[0])?.db;
    if (!aDb) return;
    try{const res=aDb.run(sql);updateActive({results:res,execErr:null});setSchemaVer(v=>v+1);}
    catch(e){updateActive({execErr:e.message,results:null});}
  }, [sql, activeId, activeFolderId]);

  useEffect(() => {
    const h=(e)=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();run();}};
    window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h);
  }, [run]);

  // ── Autocomplete pool ──
  const suggPool = useMemo(() => {
    const tables = (foldersRef.current.find(f => f.id === activeFolderId) || foldersRef.current[0])?.db?.tables || {};
    const kws = [...SQL_KW].map(k => ({ label: k, kind: 'kw' }));
    const fns = [...SQL_FN].map(f => ({ label: f, kind: 'fn' }));
    const tbls = Object.keys(tables).map(t => ({ label: t, kind: 'tbl' }));
    const seen = new Set();
    const cols = Object.values(tables).flatMap(t =>
      t.cols.filter(c => { if (seen.has(c)) return false; seen.add(c); return true; })
            .map(c => ({ label: c, kind: 'col' }))
    );
    return [...kws, ...fns, ...tbls, ...cols];
  }, [schemaVer, activeFolderId, folderVer]);

  function computeSuggestions(ta) {
    const pos = ta.selectionStart;
    const text = ta.value;
    // Find the word ending at cursor
    let start = pos;
    while (start > 0 && /\w/.test(text[start - 1])) start--;
    const word = text.slice(start, pos);
    if (word.length < 1) { setSuggestions([]); setSuggAnchor(null); return; }
    const wu = word.toUpperCase();
    const matches = suggPool
      .filter(s => s.label.toUpperCase().startsWith(wu) && s.label.toUpperCase() !== wu)
      .slice(0, 20);
    if (matches.length === 0) { setSuggestions([]); setSuggAnchor(null); return; }
    // Calculate pixel position of caret inside the editor
    const before = text.slice(0, start);
    const lines = before.split('\n');
    const lineIdx = text.slice(0, pos).split('\n').length - 1;
    const colInLine = lines[lines.length - 1].length;
    const LINE_H = 13 * 1.65;
    const CHAR_W = 7.82;
    const PAD_TOP = 12;
    const PAD_LEFT = 60;
    const top = PAD_TOP + (lineIdx + 1) * LINE_H - (ta.scrollTop || 0);
    const left = PAD_LEFT + colInLine * CHAR_W;
    setSuggestions(matches);
    setSuggSel(0);
    setSuggAnchor({ top, left, wordStart: start, word });
  }

  function applySuggestion(label) {
    const ta = taRef.current;
    if (!ta || !suggAnchor) return;
    const cursorPos = ta.selectionStart;
    const before = sql.slice(0, suggAnchor.wordStart);
    const after = sql.slice(cursorPos);
    const newSql = before + label + after;
    setSQL(newSql);
    const newPos = suggAnchor.wordStart + label.length;
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos; ta.focus(); });
    setSuggestions([]); setSuggAnchor(null);
  }

  const onKeyDown = useCallback((e) => {
    // Handle open suggestion list
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggSel(s => {
          const next = Math.min(s + 1, suggestions.length - 1);
          requestAnimationFrame(() => { suggListRef.current?.children[next]?.scrollIntoView({ block: 'nearest' }); });
          return next;
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggSel(s => {
          const next = Math.max(s - 1, 0);
          requestAnimationFrame(() => { suggListRef.current?.children[next]?.scrollIntoView({ block: 'nearest' }); });
          return next;
        });
        return;
      }
      if (e.key === 'Escape')    { e.preventDefault(); setSuggestions([]); setSuggAnchor(null); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applySuggestion(suggestions[suggSel].label);
        return;
      }
    }
    // Default Tab = 2-space indent
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = taRef.current;
      const s = ta.selectionStart, en = ta.selectionEnd;
      const nv = sql.slice(0, s) + '  ' + sql.slice(en);
      setSQL(nv);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    }
    // Auto-indentation on Enter (skip if Ctrl/Meta held — that's the Run shortcut)
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const ta = taRef.current;
      const s = ta.selectionStart, en = ta.selectionEnd;
      // Get the current line
      const beforeCursor = sql.slice(0, s);
      const lines = beforeCursor.split('\n');
      const currentLine = lines[lines.length - 1];
      // Calculate indentation of current line
      const indentMatch = currentLine.match(/^(\s*)/);
      const currentIndent = indentMatch ? indentMatch[1] : '';
      // Check if current line has unmatched opening brackets
      let openCount = 0, closeCount = 0;
      for (const ch of currentLine) {
        if (['(', '[', '{'].includes(ch)) openCount++;
        if ([')', ']', '}'].includes(ch)) closeCount++;
      }
      const extraIndent = openCount > closeCount ? '  ' : '';
      const newIndent = currentIndent + extraIndent;
      const selectedText = sql.slice(s, en);
      const nv = sql.slice(0, s) + '\n' + newIndent + sql.slice(en);
      setSQL(nv);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1 + newIndent.length; });
    }
    // Smart bracket deletion: delete matching closing bracket when opening bracket is deleted
    const closingMap = { '(': ')', '[': ']', '{': '}' };
    const reverseMap = { ')': '(', ']': '[', '}': '{' };
    // Helper to find matching closing bracket
    const findMatchingClosing = (text, openPos, openBracket) => {
      const closeBracket = closingMap[openBracket];
      let depth = 1;
      for (let i = openPos + 1; i < text.length; i++) {
        if (text[i] === openBracket) depth++;
        if (text[i] === closeBracket) {
          depth--;
          if (depth === 0) return i;
        }
      }
      return -1;
    };
    // Backspace: delete opening bracket and matching closing bracket
    if (e.key === 'Backspace') {
      const ta = taRef.current;
      const s = ta.selectionStart;
      const charBeforeCursor = sql[s - 1];
      if (['(', '[', '{'].includes(charBeforeCursor)) {
        const matchingPos = findMatchingClosing(sql, s - 1, charBeforeCursor);
        if (matchingPos !== -1) {
          e.preventDefault();
          const nv = sql.slice(0, s - 1) + sql.slice(s, matchingPos) + sql.slice(matchingPos + 1);
          setSQL(nv);
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s - 1; });
          return;
        }
      }
    }
    // Delete: delete opening bracket and matching closing bracket
    if (e.key === 'Delete') {
      const ta = taRef.current;
      const s = ta.selectionStart;
      const charAtCursor = sql[s];
      if (['(', '[', '{'].includes(charAtCursor)) {
        const matchingPos = findMatchingClosing(sql, s, charAtCursor);
        if (matchingPos !== -1) {
          e.preventDefault();
          const nv = sql.slice(0, s) + sql.slice(s + 1, matchingPos) + sql.slice(matchingPos + 1);
          setSQL(nv);
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s; });
          return;
        }
      }
    }
    // Smart bracket handling: exit if cursor is before matching closing bracket
    if ([')' , ']', '}'].includes(e.key)) {
      const ta = taRef.current;
      const s = ta.selectionStart;
      // If next char is the closing bracket we're typing, skip insertion and move cursor forward
      if (sql[s] === e.key) {
        e.preventDefault();
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1; });
        return;
      }
    }
    // Auto-close brackets (opening brackets)
    if (['(', '[', '{'].includes(e.key)) {
      e.preventDefault();
      const ta = taRef.current;
      const s = ta.selectionStart, en = ta.selectionEnd;
      const closing = closingMap[e.key];
      const selectedText = sql.slice(s, en);
      const nv = sql.slice(0, s) + e.key + selectedText + closing + sql.slice(en);
      setSQL(nv);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + e.key.length; });
    }
  }, [sql, suggestions, suggSel, suggAnchor]);

  // ── Multi-editor management ──
  function addEditor() {
    const ed = makeEditor('-- New query\nSELECT * FROM employees LIMIT 5;');
    setEditors(eds => [...eds, ed]);
    setActiveId(ed.id);
  }
  function closeEditor(id, e) {
    e.stopPropagation();
    setEditors(eds => {
      const next = eds.filter(e => e.id !== id);
      if (next.length === 0) {
        const fresh = makeEditor();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[next.length - 1].id);
      return next;
    });
  }
  function startRename(ed, e) {
    e.stopPropagation(); e.preventDefault();
    setRenamingId(ed.id); setRenameVal(ed.name);
  }
  function commitRename() {
    if (renameVal.trim()) updateActive({ name: renameVal.trim() });
    setRenamingId(null);
  }

  // ── Export ──
  function exportSQL() {
    const blob = new Blob([sql], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${activeEditor?.name || 'query'}.sql`;
    a.click(); URL.revokeObjectURL(url);
  }

  const schema = activeDb?.tables || {};
  const results = activeEditor?.results;
  const execErr = activeEditor?.execErr;

  // ── Folder management ──
  function addFolder() {
    const f = makeFolder(`Database ${foldersRef.current.length + 1}`, false);
    foldersRef.current = [...foldersRef.current, f];
    setActiveFolderId(f.id);
    setExpandedFolderIds(s => new Set([...s, f.id]));
    setFolderVer(v => v + 1);
    setSchemaVer(v => v + 1);
  }
  function deleteFolder(id, e) {
    e?.stopPropagation();
    if (foldersRef.current.length <= 1) return;
    foldersRef.current = foldersRef.current.filter(f => f.id !== id);
    if (activeFolderId === id) {
      const next = foldersRef.current[0];
      setActiveFolderId(next.id);
    }
    setFolderVer(v => v + 1);
    setSchemaVer(v => v + 1);
  }
  function openFolder(id) {
    setActiveFolderId(id);
    setExpandedFolderIds(s => new Set([...s, id]));
    setSchemaVer(v => v + 1);
    updateActive({ results: null, execErr: null });
  }
  function toggleFolderExpand(id, e) {
    e?.stopPropagation();
    setExpandedFolderIds(s => {
      const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
    });
  }
  function startFolderRename(f, e) {
    e?.stopPropagation(); e?.preventDefault();
    setRenamingFolderId(f.id); setFolderRenameVal(f.name);
  }
  function commitFolderRename() {
    if (folderRenameVal.trim()) {
      foldersRef.current = foldersRef.current.map(f =>
        f.id === renamingFolderId ? { ...f, name: folderRenameVal.trim() } : f
      );
      setFolderVer(v => v + 1);
    }
    setRenamingFolderId(null);
  }
  const displayResult = results?.filter(r=>r.kind==='rows').at(-1);
  const messages = results?.filter(r=>r.kind==='msg');

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

  const edS = {fontFamily:MONO,fontSize:'13px',lineHeight:'1.65',padding:'12px 16px 12px 60px',tabSize:2,whiteSpace:'pre-wrap',wordBreak:'break-all',textAlign:'left', letterSpacing:'normal'};

  function copySnippet(sql, id) {
    navigator.clipboard.writeText(sql).catch(()=>{});
    setCopiedSnippet(id);setTimeout(()=>setCopiedSnippet(null),1500);
  }

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100vh',width:'100%',background:BG,color:TEXT,fontFamily:SANS,overflow:'hidden'}}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { width: 100%; height: 100%; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #424242; border-radius: 0; }
        ::-webkit-scrollbar-thumb:hover { background: #555; }
        textarea { outline: none; border: none; resize: none; }
        .btn-hover:hover { filter: brightness(1.15); }
        .row-hover:hover { background: rgba(255,255,255,0.04) !important; }
        .schema-row:hover { background: rgba(255,255,255,0.06); }
        .snippet-card:hover { border-color: ${ACCENT}66 !important; }
        .editor-tab:hover { background: ${BG} !important; }
        .folder-row:hover .folder-actions { opacity: 1 !important; }
        .folder-row:hover { background: rgba(255,255,255,0.06) !important; }
        .tbl-row:hover { background: rgba(255,255,255,0.04) !important; }
        .resize-handle-x { cursor: col-resize; width: 4px; background: transparent; flex-shrink:0; transition: background 0.15s; }
        .resize-handle-x:hover, .resize-handle-x:active { background: ${ACCENT}88; }
        .resize-handle-y { cursor: row-resize; height: 4px; background: transparent; flex-shrink:0; transition: background 0.15s; }
        .resize-handle-y:hover, .resize-handle-y:active { background: ${ACCENT}88; }
      `}</style>

      {/* ── HEADER / TITLE BAR ── */}
      <header style={{display:'flex',alignItems:'center',height:35,borderBottom:`1px solid ${BORDER}`,background:'#323233',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'0 16px',height:'100%',borderRight:`1px solid ${BORDER}`,flexShrink:0}}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="2" width="6" height="12" rx="1" fill={ACCENT} opacity="0.9"/>
            <rect x="9" y="2" width="6" height="5" rx="1" fill={ACCENT} opacity="0.55"/>
            <rect x="9" y="9" width="6" height="5" rx="1" fill={AMBER} opacity="0.9"/>
          </svg>
          <span style={{fontFamily:MONO,fontSize:12,fontWeight:600,color:TEXT}}>SQL Codelab</span>
        </div>
        <div style={{display:'flex',height:'100%'}}>
          {[{id:'editor',label:'Editor'},{id:'tablebuilder',label:'Table Builder'},{id:'cookbook',label:'Cookbook'},{id:'erdiagram',label:'ER Diagram'},{id:'practice',label:'Practice'}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} className="btn-hover" style={{
              padding:'0 16px', border:'none', height:'100%',
              background: tab===t.id ? BG : 'transparent',
              color: tab===t.id ? TEXT : MUTED,
              fontFamily:SANS, fontSize:12, fontWeight:400, cursor:'pointer',
              borderRight:`1px solid ${BORDER}`,
              borderTop: tab===t.id ? `1px solid ${ACCENT}` : '1px solid transparent',
              position:'relative', top: tab===t.id ? 0 : 0,
            }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center',paddingRight:14}}>
          {lintErrors.length>0&&<span style={{fontSize:11,color:RED,fontFamily:MONO}}>⚠ {lintErrors.length} problem{lintErrors.length>1?'s':''}</span>}
        </div>
      </header>

      {tab==='editor' ? (
        /* ── EDITOR TAB ── */
        <div style={{display:'flex',flex:1,overflow:'hidden'}}>

          {/* Sidebar */}
          {sidebarOpen && (
            <aside style={{width:sidebarWidth,borderRight:`1px solid ${BORDER}`,background:SURF,display:'flex',flexDirection:'column',overflow:'hidden',flexShrink:0}}>

              {/* Explorer header */}
              <div style={{padding:'0 8px 0 12px',height:35,display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0,borderBottom:`1px solid ${BORDER}`}}>
                <span style={{fontSize:11,fontWeight:700,letterSpacing:'0.08em',color:MUTED,textTransform:'uppercase',userSelect:'none',fontFamily:SANS}}>Explorer</span>
                <div style={{display:'flex',gap:2}}>
                  <button title="New Database" onClick={addFolder} className="btn-hover"
                    style={{background:'none',border:'none',color:MUTED,cursor:'pointer',fontSize:17,lineHeight:'1',padding:'2px 4px',borderRadius:3}}>+</button>
                  <button onClick={()=>setSidebarOpen(false)} title="Close Explorer" className="btn-hover"
                    style={{background:'none',border:'none',color:MUTED,cursor:'pointer',fontSize:13,lineHeight:'1',padding:'2px 4px',borderRadius:3}}>✕</button>
                </div>
              </div>

              {/* Tree scroll area */}
              <div style={{overflowY:'auto',flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:4,padding:'6px 10px 4px 8px',userSelect:'none'}}>
                  <span style={{fontSize:10,color:MUTED,fontWeight:700}}>▾</span>
                  <span style={{fontSize:11,fontWeight:700,color:MUTED,textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:SANS}}>SQL-CODELAB</span>
                </div>

                {foldersRef.current.map(folder => {
                  const isActive = folder.id === activeFolderId;
                  const isExpanded = expandedFolderIds.has(folder.id);
                  const folderTables = Object.entries(folder.db?.tables || {});
                  return (
                    <div key={folder.id + '-' + folderVer}>
                      <div className="folder-row" onClick={() => openFolder(folder.id)}
                        style={{display:'flex',alignItems:'center',gap:0,padding:'3px 6px 3px 14px',cursor:'pointer',userSelect:'none',
                          borderLeft:`2px solid ${isActive ? ACCENT : 'transparent'}`,
                          background: isActive ? `${ACCENT}15` : 'transparent',
                          position:'relative'}}>
                        <span onClick={e=>toggleFolderExpand(folder.id,e)}
                          style={{fontSize:10,color:MUTED,width:14,flexShrink:0,display:'inline-block',
                            transform:isExpanded?'rotate(90deg)':'none',textAlign:'center',transition:'transform 0.1s'}}>›</span>
                        {/* Folder icon — simple SVG, no Fragment */}
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{flexShrink:0,marginRight:5}}>
                          <path d="M1 4a1 1 0 011-1h4.5l1.5 1.5H14a1 1 0 011 1v6a1 1 0 01-1 1H2a1 1 0 01-1-1V4z"
                            fill={isActive || isExpanded ? ACCENT : MUTED} opacity={isActive || isExpanded ? '0.7' : '0.45'}/>
                        </svg>
                        {renamingFolderId === folder.id ? (
                          <input autoFocus value={folderRenameVal}
                            onChange={e=>setFolderRenameVal(e.target.value)}
                            onBlur={commitFolderRename}
                            onKeyDown={e=>{if(e.key==='Enter')commitFolderRename();if(e.key==='Escape')setRenamingFolderId(null);}}
                            onClick={e=>e.stopPropagation()}
                            style={{flex:1,background:SURF2,border:`1px solid ${ACCENT}`,borderRadius:2,color:TEXT,fontFamily:MONO,fontSize:11,padding:'1px 4px',outline:'none'}}/>
                        ) : (
                          <span onDoubleClick={e=>startFolderRename(folder,e)}
                            style={{flex:1,fontSize:12,fontFamily:MONO,color:isActive?TEXT:MUTED,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:isActive?600:400}}>
                            {folder.name}
                          </span>
                        )}
                        <div className="folder-actions" style={{display:'flex',gap:2,opacity:0,transition:'opacity 0.1s',flexShrink:0,marginLeft:2}}>
                          <button title="Rename" onClick={e=>startFolderRename(folder,e)} className="btn-hover"
                            style={{background:'none',border:'none',color:MUTED,cursor:'pointer',fontSize:12,padding:'0 3px',lineHeight:1}}>✎</button>
                          {foldersRef.current.length > 1 && (
                            <button title="Delete" onClick={e=>deleteFolder(folder.id,e)} className="btn-hover"
                              style={{background:'none',border:'none',color:MUTED,cursor:'pointer',fontSize:11,padding:'0 3px',lineHeight:1}}>✕</button>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div>
                          {folderTables.length === 0 ? (
                            <div style={{padding:'4px 12px 4px 36px',fontSize:10,color:MUTED,fontStyle:'italic',fontFamily:SANS}}>
                              No tables — run CREATE TABLE
                            </div>
                          ) : folderTables.map(([tname, tbl]) => (
                            <div key={tname + schemaVer}>
                              <div className="tbl-row schema-row"
                                onClick={()=>setExpandedTbls(s=>{const n=new Set(s);n.has(tname)?n.delete(tname):n.add(tname);return n;})}
                                style={{display:'flex',alignItems:'center',gap:5,padding:'3px 10px 3px 30px',cursor:'pointer',userSelect:'none'}}>
                                <span style={{fontSize:10,color:MUTED,display:'inline-block',transform:expandedTbls.has(tname)?'rotate(90deg)':'none',transition:'transform 0.1s'}}>›</span>
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{flexShrink:0}}>
                                  <rect x="1" y="2" width="14" height="12" rx="1" stroke={MUTED} strokeWidth="1.3" fill="none"/>
                                  <line x1="1" y1="6" x2="15" y2="6" stroke={MUTED} strokeWidth="1"/>
                                  <line x1="5" y1="2" x2="5" y2="14" stroke={MUTED} strokeWidth="1"/>
                                </svg>
                                <span style={{fontSize:11,fontFamily:MONO,color:TEXT,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tname}</span>
                                <span style={{fontSize:9,color:MUTED,fontFamily:MONO,flexShrink:0}}>{tbl.rows.length}</span>
                              </div>
                              {expandedTbls.has(tname) && tbl.cols.map(col=>(
                                <div key={col} style={{padding:'2px 10px 2px 50px',fontSize:11,fontFamily:MONO,color:MUTED,display:'flex',alignItems:'center',gap:5}}>
                                  <span style={{color:ACCENT,fontSize:9,flexShrink:0}}>─</span>
                                  <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{col}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{borderTop:`1px solid ${BORDER}`,padding:'8px 10px'}}>
                <button onClick={()=>{activeDb?.seed();setSchemaVer(v=>v+1);updateActive({results:null,execErr:null});}} className="btn-hover"
                  style={{width:'100%',padding:'5px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>
                  Reset Active DB
                </button>
              </div>
            </aside>
          )}

          {/* Sidebar resize handle */}
          {sidebarOpen && (
            <div className="resize-handle-x" onMouseDown={startSidebarDrag} style={{borderRight:`1px solid ${BORDER}`}}/>
          )}

          {/* Main Editor + Results */}
          <div data-editor-container style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

            {/* Editor Tabs + Toolbar */}
            <div style={{display:'flex',flexDirection:'column',background:SURF,borderBottom:`1px solid ${BORDER}`,flexShrink:0}}>
              {/* Tab bar */}
              <div style={{display:'flex',alignItems:'stretch',overflowX:'auto',borderBottom:`1px solid ${BORDER}`,height:35,background:SURF}}>
                {!sidebarOpen && (
                  <button onClick={()=>setSidebarOpen(true)} title="Show Explorer" className="btn-hover"
                    style={{padding:'0 12px',background:'none',border:'none',borderRight:`1px solid ${BORDER}`,color:MUTED,cursor:'pointer',fontSize:15,flexShrink:0}}>
                    ☰
                  </button>
                )}
                {editors.map(ed=>(
                  <div key={ed.id} className="editor-tab" onClick={()=>setActiveId(ed.id)}
                    style={{display:'flex',alignItems:'center',gap:6,padding:'0 12px',cursor:'pointer',
                      borderRight:`1px solid ${BORDER}`,flexShrink:0,
                      background: ed.id===activeId ? BG : SURF,
                      borderTop: ed.id===activeId ? `1px solid ${ACCENT}` : '1px solid transparent',
                      minWidth:100, maxWidth:180}}>
                    {renamingId===ed.id ? (
                      <input autoFocus value={renameVal} onChange={e=>setRenameVal(e.target.value)}
                        onBlur={commitRename} onKeyDown={e=>{if(e.key==='Enter')commitRename();if(e.key==='Escape')setRenamingId(null);}}
                        onClick={e=>e.stopPropagation()}
                        style={{background:'transparent',border:'none',outline:'none',color:TEXT,fontFamily:MONO,fontSize:12,width:'100%'}}/>
                    ) : (
                      <span onDoubleClick={e=>startRename(ed,e)} style={{fontSize:12,fontFamily:MONO,color:ed.id===activeId?TEXT:MUTED,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>
                        {ed.name}
                      </span>
                    )}
                    <button onClick={e=>closeEditor(ed.id,e)} className="btn-hover"
                      style={{background:'none',border:'none',color:MUTED,cursor:'pointer',fontSize:12,lineHeight:1,padding:'0 1px',flexShrink:0,opacity:ed.id===activeId?0.7:0.3}}>✕</button>
                  </div>
                ))}
                <button onClick={addEditor} title="New tab" className="btn-hover"
                  style={{padding:'0 12px',background:'none',border:'none',borderRight:`1px solid ${BORDER}`,color:MUTED,cursor:'pointer',fontSize:18,flexShrink:0}}>+</button>
              </div>
              {/* Toolbar */}
              <div style={{display:'flex',alignItems:'center',gap:6,padding:'5px 12px'}}>
                <button onClick={run} className="btn-hover" style={{display:'flex',alignItems:'center',gap:5,padding:'4px 12px',background:BLUE,color:'#fff',border:'none',borderRadius:2,fontWeight:600,fontSize:12,fontFamily:SANS,cursor:'pointer'}}>
                  ▶ Run
                </button>
                <button onClick={()=>setSQL(DEFAULT_SQL)} className="btn-hover" style={{padding:'4px 10px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:12,fontFamily:SANS,cursor:'pointer'}}>
                  Reset
                </button>
                <button onClick={()=>setSQL('')} className="btn-hover" style={{padding:'4px 10px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:12,fontFamily:SANS,cursor:'pointer'}}>
                  Clear
                </button>
                <button onClick={exportSQL} className="btn-hover"
                  style={{padding:'4px 10px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:12,fontFamily:SANS,cursor:'pointer'}}>
                  Export .sql
                </button>
                <div style={{marginLeft:'auto',fontSize:11,color:MUTED,fontFamily:MONO}}>Ctrl+Enter to run</div>
              </div>
            </div>

            {/* Code Editor (flex height = 100% - resultsHeight if open, else 100%) */}
            <div style={{flex: resultsOpen ? `0 0 ${100 - resultsHeight}%` : '1', position:'relative',overflow:'hidden',borderBottom: resultsOpen ? `1px solid ${BORDER}` : 'none'}}>
              {/* Line numbers */}
              <div ref={lnRef} style={{position:'absolute',left:0,top:0,bottom:0,width:44,background:BG,borderRight:`1px solid ${BORDER}22`,overflowY:'hidden',pointerEvents:'none',zIndex:2}}>
                <div style={{...edS,padding:'12px 8px 12px 0',color:'#4E4E4E',textAlign:'right',userSelect:'none',fontSize:'13px'}}>
                  {Array.from({length:lineCount},(_,i)=>`${i+1}\n`).join('')}
                </div>
              </div>
              {/* Highlight overlay */}
              <pre ref={hlRef} aria-hidden style={{...edS,position:'absolute',top:0,left:0,right:0,bottom:0,margin:0,overflow:'hidden',pointerEvents:'none',zIndex:1,color:TEXT}} dangerouslySetInnerHTML={{__html:highlighted+'<br/>'}}/>
              {/* Textarea */}
              <textarea ref={taRef} value={sql} onChange={e=>{ setSQL(e.target.value); computeSuggestions(e.target); }} onScroll={onScroll} onKeyDown={onKeyDown}
                onBlur={()=>setTimeout(()=>{ setSuggestions([]); setSuggAnchor(null); }, 150)}
                spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
                style={{...edS,position:'absolute',top:0,left:0,right:0,bottom:0,width:'100%',height:'100%',background:'transparent',color:'transparent',caretColor:TEXT,zIndex:3,overflowY:'auto',overflowX:'auto'}}/>
              {/* Autocomplete dropdown */}
              {suggestions.length > 0 && suggAnchor && (
                <div style={{position:'absolute',top:suggAnchor.top,left:Math.min(suggAnchor.left, 'calc(100% - 220px)'),zIndex:20,
                  background:SURF2,border:`1px solid ${BORDER}`,borderRadius:2,overflow:'hidden',
                  boxShadow:'0 4px 16px rgba(0,0,0,0.5)',minWidth:180,maxWidth:260,pointerEvents:'all'}}>
                  <div style={{padding:'3px 8px',fontSize:10,color:MUTED,fontFamily:MONO,letterSpacing:'0.06em',borderBottom:`1px solid ${BORDER}`,background:SURF,whiteSpace:'nowrap'}}>
                    SUGGESTIONS &nbsp;<span style={{opacity:0.5}}>↑↓ Tab Esc</span>
                  </div>
                  <div ref={suggListRef} style={{maxHeight:200,overflowY:'auto',overflowX:'hidden'}}>
                  {suggestions.map((s, i) => {
                    const kindColor = s.kind==='kw'?ACCENT:s.kind==='fn'?'#DCDCAA':s.kind==='tbl'?GREEN:'#9CDCFE';
                    const kindLabel = s.kind==='kw'?'kw':s.kind==='fn'?'fn':s.kind==='tbl'?'tbl':'col';
                    return (
                      <div key={i} onMouseDown={e=>{e.preventDefault(); applySuggestion(s.label);}}
                        style={{display:'flex',alignItems:'center',gap:6,padding:'4px 8px',cursor:'pointer',
                          background: i===suggSel ? `${ACCENT}22` : 'transparent',
                          borderLeft: `2px solid ${i===suggSel ? ACCENT : 'transparent'}`,
                          color: i===suggSel ? TEXT : MUTED}}>
                        <span style={{fontSize:9,fontFamily:MONO,fontWeight:700,color:kindColor,padding:'1px 4px',borderRadius:2,flexShrink:0,minWidth:24,textAlign:'center'}}>
                          {kindLabel}
                        </span>
                        <span style={{fontFamily:MONO,fontSize:12,flex:1}}>
                          <span style={{color:ACCENT,fontWeight:700}}>{s.label.slice(0, suggAnchor.word.length)}</span>
                          {s.label.slice(suggAnchor.word.length)}
                        </span>
                        {i === suggSel && <span style={{fontSize:9,color:MUTED,flexShrink:0}}>Tab</span>}
                      </div>
                    );
                  })}
                  </div>
                </div>
              )}
            </div>

            {/* Lint Errors */}
            {lintErrors.length>0&&(
              <div style={{background:'#1C1414',borderBottom:`1px solid #5C2020`,padding:'5px 14px',flexShrink:0,maxHeight:90,overflowY:'auto'}}>
                {lintErrors.map((e,i)=>(
                  <div key={i} style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:12,fontFamily:MONO,color:'#F48771',lineHeight:'1.6'}}>
                    <span style={{color:RED,flexShrink:0,fontWeight:700}}>error</span>
                    <span style={{color:MUTED,flexShrink:0}}>L{e.line}</span>
                    <span>{e.msg}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Results resize handle */}
            {resultsOpen && (
              <div className="resize-handle-y" onMouseDown={startResultsDrag} style={{borderTop:`1px solid ${BORDER}44`}}/>
            )}

            {/* Results Panel */}
            {resultsOpen ? (
              <div style={{flex:`0 0 ${resultsHeight}%`,overflow:'hidden',display:'flex',flexDirection:'column',minHeight:0}}>
                {/* Results Toolbar */}
                <div style={{display:'flex',alignItems:'center',gap:8,padding:'4px 12px',borderBottom:`1px solid ${BORDER}`,background:SURF,flexShrink:0}}>
                  <span style={{fontSize:11,fontWeight:700,color:MUTED,letterSpacing:'0.08em',textTransform:'uppercase',fontFamily:SANS}}>Results</span>
                  {sortedResult&&<>
                    <span style={{fontSize:11,color:GREEN,fontFamily:MONO,marginLeft:4}}>{sortedResult.rows.length} rows × {sortedResult.cols.length} cols</span>
                    <div style={{display:'flex',gap:3,marginLeft:'auto'}}>
                      {['table','chart','pie'].map(v=>(
                        <button key={v} onClick={()=>setResultView(v)} className="btn-hover"
                          style={{padding:'2px 9px',borderRadius:2,border:`1px solid ${resultView===v?ACCENT:BORDER}`,background:resultView===v?`${ACCENT}20`:'transparent',color:resultView===v?ACCENT:MUTED,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>
                          {v==='table'?'Table':v==='chart'?'Bar':' Pie'}
                        </button>
                      ))}
                    </div>
                  </>}
                  {execErr&&<span style={{fontSize:11,color:RED,fontFamily:MONO,marginLeft:4}}>Error</span>}
                  <button onClick={()=>setResultsOpen(false)} title="Close results" className="btn-hover"
                    style={{marginLeft:sortedResult?6:'auto',background:'none',border:'none',color:MUTED,cursor:'pointer',fontSize:13,lineHeight:1,padding:'0 2px'}}>✕</button>
                </div>

                {/* Results Content */}
                <div style={{flex:1,overflow:'auto',padding:'0'}}>
                  {execErr&&(
                    <div style={{margin:12,padding:10,background:'#1C1414',border:`1px solid ${RED}44`,borderRadius:2,fontFamily:MONO,fontSize:12,color:'#F48771'}}>
                      <span style={{color:RED,fontWeight:700,marginRight:8}}>error</span>{execErr}
                    </div>
                  )}
                  {messages?.map((m,i)=>(
                    <div key={i} style={{margin:'6px 12px',padding:'6px 10px',background:'#132113',border:`1px solid ${GREEN}44`,borderRadius:2,fontFamily:MONO,fontSize:12,color:GREEN}}>{m.msg}</div>
                  ))}
                  {sortedResult&&resultView==='table'&&(
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,fontFamily:MONO}}>
                        <thead>
                          <tr style={{background:SURF2,position:'sticky',top:0,zIndex:5}}>
                            <th style={{padding:'6px 10px',textAlign:'right',fontWeight:400,color:MUTED,fontSize:11,borderBottom:`1px solid ${BORDER}`,width:36}}>#</th>
                            {sortedResult.cols.map(col=>(
                              <th key={col} onClick={()=>{if(sortCol===col)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortCol(col);setSortDir('asc');}}}
                                style={{padding:'6px 12px',textAlign:'left',fontWeight:600,color:sortCol===col?ACCENT:MUTED,fontSize:11,borderBottom:`1px solid ${sortCol===col?ACCENT:BORDER}`,cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',letterSpacing:'0.02em'}}>
                                {col}{sortCol===col?sortDir==='asc'?' ↑':' ↓':''}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedResult.rows.map((row,ri)=>(
                            <tr key={ri} className="row-hover" style={{borderBottom:`1px solid ${BORDER}22`}}>
                              <td style={{padding:'5px 10px',color:MUTED,textAlign:'right',fontSize:11}}>{ri+1}</td>
                              {row.map((cell,ci)=>{
                                const isNum=cell!==null&&!isNaN(+cell)&&typeof cell!=='string';
                                return(
                                  <td key={ci} style={{padding:'5px 12px',color:cell===null?MUTED:isNum?'#B5CEA8':TEXT,fontStyle:cell===null?'italic':'normal',whiteSpace:'nowrap',maxWidth:280,overflow:'hidden',textOverflow:'ellipsis'}}>
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
                    <div style={{padding:32,textAlign:'center',color:MUTED,fontSize:12,fontFamily:MONO}}>
                      Run a query to see results here
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{borderTop:`1px solid ${BORDER}`,background:SURF,padding:'4px 14px',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                <span style={{fontSize:11,color:MUTED,fontFamily:MONO,textTransform:'uppercase',letterSpacing:'0.06em'}}>Results</span>
                {sortedResult&&<span style={{fontSize:11,color:GREEN,fontFamily:MONO}}>{sortedResult.rows.length} rows</span>}
                {execErr&&<span style={{fontSize:11,color:RED,fontFamily:MONO}}>Error</span>}
                <button onClick={()=>setResultsOpen(true)} className="btn-hover"
                  style={{marginLeft:'auto',padding:'2px 10px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>
                  Show Results
                </button>
              </div>
            )}
          </div>
        </div>
      ) : tab === 'tablebuilder' ? (
        /* ── TABLE BUILDER TAB ── */
        <TableBuilder
          onRunSQL={(sql) => {
            setSQL(sql);
            try {
              const res = activeDb.run(sql);
              updateActive({ results: res, execErr: null });
              setSchemaVer(v => v + 1);
            } catch(e) {
              updateActive({ execErr: e.message, results: null });
            }
          }}
          onSendToEditor={(sql) => { setSQL(sql); setTab('editor'); }}
        />
      ) : tab === 'erdiagram' ? (
        /* ── ER DIAGRAM TAB ── */
        <ERDiagram schema={schema} schemaVer={schemaVer + folderVer + activeFolderId} />
      ) : tab === 'practice' ? (
        /* ── PRACTICE TAB ── */
        <PracticeTab activeDb={activeDb} isMobile={isMobile} />
      ) : (
        /* ── COOKBOOK TAB ── */
        <div style={{display:'flex',flex:1,overflow:'hidden',flexDirection:isMobile?'column':'row'}}>
          {/* Category Sidebar */}
          {(!isMobile||cookSidebarOpen)&&(
            <aside style={{width:isMobile?'100%':190,maxHeight:isMobile?200:'none',borderRight:isMobile?'none':`1px solid ${BORDER}`,borderBottom:isMobile?`1px solid ${BORDER}`:'none',background:SURF,overflowY:'auto',flexShrink:0}}>
              <div style={{padding:'8px 12px 6px',fontSize:10,fontWeight:700,letterSpacing:'0.1em',color:MUTED,textTransform:'uppercase',fontFamily:SANS,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span>Categories</span>
                {isMobile&&<button onClick={()=>setCookSidebarOpen(false)} style={{background:'transparent',border:'none',color:MUTED,cursor:'pointer',fontSize:14,lineHeight:1,padding:'0 2px'}}>✕</button>}
              </div>
              <div style={{display:'flex',flexDirection:isMobile?'row':'column',flexWrap:isMobile?'wrap':'nowrap',gap:isMobile?2:0,padding:isMobile?'4px 8px 8px':0}}>
                {COOKBOOK.map(cat=>(
                  <div key={cat.id} onClick={()=>{setCookCat(cat.id);if(isMobile)setCookSidebarOpen(false);}} className="schema-row"
                    style={{display:'flex',alignItems:'center',gap:8,padding:isMobile?'5px 10px':'7px 14px',cursor:'pointer',
                      background:cookCat===cat.id?`${ACCENT}18`:'transparent',
                      borderLeft:isMobile?'none':`2px solid ${cookCat===cat.id?ACCENT:'transparent'}`,
                      borderRadius:isMobile?3:0,
                      border:isMobile?`1px solid ${cookCat===cat.id?ACCENT:BORDER}`:undefined,
                      transition:'background 0.1s'}}>
                    <span style={{fontSize:12,fontFamily:MONO,fontWeight:cookCat===cat.id?600:400,color:cookCat===cat.id?TEXT:MUTED}}>{cat.label}</span>
                  </div>
                ))}
              </div>
            </aside>
          )}

          {/* Snippet Grid */}
          <div style={{flex:1,overflowY:'auto',padding:isMobile?12:20}}>
            {isMobile&&!cookSidebarOpen&&(
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                <button onClick={()=>setCookSidebarOpen(true)} className="btn-hover"
                  style={{padding:'4px 10px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:11,fontFamily:SANS,cursor:'pointer'}}>
                  ☰ Categories
                </button>
                <span style={{fontSize:12,color:TEXT,fontFamily:MONO,fontWeight:600}}>{COOKBOOK.find(c=>c.id===cookCat)?.label}</span>
              </div>
            )}
            {COOKBOOK.filter(c=>c.id===cookCat).map(cat=>(
              <div key={cat.id}>
                <h2 style={{margin:'0 0 14px',fontSize:14,fontWeight:600,color:TEXT,textAlign:'left',fontFamily:SANS,letterSpacing:'0.01em'}}>
                  {cat.label}
                  <span style={{marginLeft:10,fontSize:11,fontWeight:400,color:MUTED}}>{cat.items.length} snippets</span>
                </h2>
                <div style={{display:'grid',gridTemplateColumns:`repeat(auto-fill,minmax(${isMobile?'260px':'380px'},1fr))`,gap:isMobile?10:14}}>
                  {cat.items.map((item,idx)=>(
                    <div key={idx} className="snippet-card" style={{background:SURF,border:`1px solid ${BORDER}`,borderRadius:2,overflow:'hidden',transition:'border-color 0.12s'}}>
                      <div style={{padding:'10px 14px 8px',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:12,fontWeight:600,color:TEXT,marginBottom:3,fontFamily:SANS}}>{item.title}</div>
                          <div style={{fontSize:11,color:MUTED,lineHeight:'1.4',fontFamily:SANS}}>{item.desc}</div>
                        </div>
                        <div style={{display:'flex',gap:5,marginLeft:12,flexShrink:0}}>
                          <button onClick={()=>copySnippet(item.sql,`${cat.id}-${idx}`)} className="btn-hover"
                            style={{padding:'3px 9px',background:'transparent',border:`1px solid ${BORDER}`,borderRadius:2,color:MUTED,fontSize:11,fontFamily:SANS,cursor:'pointer',whiteSpace:'nowrap'}}>
                            {copiedSnippet===`${cat.id}-${idx}`?'Copied':'Copy'}
                          </button>
                          <button onClick={()=>{setSQL(item.sql);setTab('editor');}} className="btn-hover"
                            style={{padding:'3px 9px',background:BLUE,border:'none',borderRadius:2,color:'#fff',fontSize:11,fontFamily:SANS,cursor:'pointer',whiteSpace:'nowrap'}}>
                            Run
                          </button>
                        </div>
                      </div>
                      <pre style={{margin:0,padding:'8px 14px 10px',background:BG,fontSize:isMobile?11:12,fontFamily:MONO,lineHeight:'1.6',overflowX:'auto',color:TEXT,textAlign:'left'}} dangerouslySetInnerHTML={{__html:highlight(item.sql)}}/>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status Bar */}
      <div style={{display:'flex',alignItems:'stretch',height:22,background:BLUE,fontSize:11,fontFamily:MONO,color:'rgba(255,255,255,0.9)',flexShrink:0}}>
        <span style={{padding:'0 10px',display:'flex',alignItems:'center',gap:5,borderRight:'1px solid rgba(255,255,255,0.15)',color:lintErrors.length?'#FFD2CE':'rgba(255,255,255,0.9)'}}>
          {lintErrors.length?`⚠ ${lintErrors.length} problem${lintErrors.length>1?'s':''}`:'✓ No problems'}
        </span>
        <span style={{padding:'0 10px',display:'flex',alignItems:'center',borderRight:'1px solid rgba(255,255,255,0.15)'}}>
          {getActiveFolder()?.name}
        </span>
        <span style={{padding:'0 10px',display:'flex',alignItems:'center',borderRight:'1px solid rgba(255,255,255,0.15)'}}>Tables: {Object.keys(schema).length}</span>
        {sortedResult&&<span style={{padding:'0 10px',display:'flex',alignItems:'center'}}>Last: {sortedResult.rows.length} rows</span>}
        <span style={{marginLeft:'auto',padding:'0 10px',display:'flex',alignItems:'center',borderLeft:'1px solid rgba(255,255,255,0.15)'}}>{lineCount} lines · SQL · UTF-8</span>
      </div>
    </div>
  );
}