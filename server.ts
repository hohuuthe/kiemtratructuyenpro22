import express from 'express';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'node:path';
import {createServer as createViteServer} from 'vite';
import {dispatchPagesApi} from './src/pages-api-dispatch';

dotenv.config();
const production=process.env.NODE_ENV === 'production' || process.argv[1]?.endsWith('.cjs');
async function startServer() {
  const app=express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req,res,next)=>{
    if (/(?:\.(?:sql|db|sqlite|sqlite3|map|cjs)|\/\.env(?:\.[^/]*)?|\/server\.ts)$/i.test(req.path)) return res.status(404).end();
    next();
  });
  app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:15,standardHeaders:true,legacyHeaders:false}));
  app.use('/api',rateLimit({windowMs:5*60*1000,limit:500,standardHeaders:true,legacyHeaders:false}));
  app.use('/api',express.raw({type:()=>true,limit:'32mb'}));
  app.use('/api',async(req,res)=>{
    try {
      const host=req.headers.host || 'localhost';
      const url=new URL(req.originalUrl, `${req.secure?'https':'http'}://${host}`);
      const headers=new Headers();
      for (const [key,value] of Object.entries(req.headers)) if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
      const body=Buffer.isBuffer(req.body)&&req.body.length?req.body:undefined;
      const request=new Request(url,{method:req.method,headers,...(body?{body}: {})});
      const result=await dispatchPagesApi(request,process.env);
      res.status(result.status);
      result.headers.forEach((value,key)=>res.setHeader(key,value));
      res.send(Buffer.from(await result.arrayBuffer()));
    } catch { res.status(503).json({error:'Service unavailable'}); }
  });
  if (!production) {
    const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve('dist'),{dotfiles:'deny'}));
    app.get('*',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));
  }
  const port=Number(process.env.PORT || 3000);
  app.listen(port,process.env.HOST || '0.0.0.0',()=>console.log('[SERVER] listening on port',port));
}
startServer().catch(()=>{console.error('[SERVER] startup failed');process.exitCode=1;});
