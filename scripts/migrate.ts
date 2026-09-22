import {connect,migrate} from '../packages/db/src/index.js';
const db=connect(process.env.DATABASE_URL??'postgresql://nexus:nexus@127.0.0.1:55432/nexus');
try{await migrate(db);}finally{await db.destroy();}
