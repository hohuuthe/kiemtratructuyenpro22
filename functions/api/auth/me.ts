import {getDatabase} from '../exam/utils';
export async function onRequestGet(context:any) {
 const user=context.data?.authUser;
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 if(!user)return new Response(JSON.stringify({error:'Session invalid'}),{status:401,headers});
 const db=getDatabase(context);
 const row=await db.prepare('SELECT a.id,a.user_id,a.username,a.role,a.is_active,a.expiry_date,u.full_name,u.phone_number,u.donvi,u.lop,u.gender,u.dob,u.address,u.occupation,u.payment_status,u.payment_method FROM accounts a LEFT JOIN users u ON u.id=COALESCE(a.user_id,a.id) WHERE a.id=?').bind(user.id).first();
 if(!row)return new Response(JSON.stringify({error:'Session invalid'}),{status:401,headers});
 return new Response(JSON.stringify({data:{...row,role:user.role,target_audience:user.target_audience,full_name:user.full_name,donvi:user.donvi,lop:user.lop},error:null}),{status:200,headers});
}
