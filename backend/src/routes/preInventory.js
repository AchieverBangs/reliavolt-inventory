const express = require('express');
const pool = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const router = express.Router();
// Purchase costs and allocation across shops are administered centrally.
router.use(verifyToken, requireRole('Admin'));
const validMoney = value => /^\d{1,12}(\.\d{1,2})?$/.test(String(value ?? ''));
function valid(body) {
    return typeof body.name === 'string' && body.name.trim().length > 0 && body.name.trim().length <= 255
        && ['category', 'brand', 'reference'].every(key => body[key] == null || typeof body[key] === 'string' && body[key].length <= 100)
        && validMoney(body.cost_price) && validMoney(body.selling_price) && validMoney(body.commission ?? 0)
        && (body.commission_user_id == null || Number.isSafeInteger(body.commission_user_id) && body.commission_user_id > 0)
        && Number.isInteger(body.quantity) && body.quantity > 0 && body.quantity <= 2147483647
        && Array.isArray(body.allocations) && body.allocations.length > 0 && body.allocations.length <= 500
        && body.allocations.every(a => a && Number.isSafeInteger(a.shop_id) && a.shop_id > 0 && Number.isInteger(a.quantity) && a.quantity > 0)
        && new Set(body.allocations.map(a => a.shop_id)).size === body.allocations.length
        && body.allocations.reduce((sum,a) => sum + a.quantity, 0) === body.quantity;
}
router.get('/', async (req,res,next) => {
    try {
        const {rows} = await pool.query(`SELECT p.*, COALESCE((SELECT json_agg(json_build_object(
            'shop_id',a.shop_id,'shop_name',s.name,'quantity',a.quantity,'product_id',a.product_id) ORDER BY s.name)
            FROM pre_inventory_allocations a JOIN shops s ON s.id=a.shop_id WHERE a.pre_inventory_id=p.id), '[]'::json) AS allocations
            FROM pre_inventory p ORDER BY p.id DESC`);
        res.json(rows);
    } catch(err) {next(err);}
});
async function save(req,res,next) {
    if (!valid(req.body)) return res.status(400).json({error:'Enter a product name, valid prices, positive whole quantities, and shop allocations adding up to the purchased quantity.'});
    if (req.params.id && !/^\d+$/.test(req.params.id)) return res.status(400).json({error:'Invalid pre-inventory item.'});
    let client;
    try {
        client = await pool.connect(); await client.query('BEGIN');
        const b=req.body;
        let item;
        if (req.params.id) {
            const {rows}=await client.query('SELECT * FROM pre_inventory WHERE id=$1 FOR UPDATE',[req.params.id]);
            if (!rows.length || rows[0].received_at) {await client.query('ROLLBACK');return res.status(409).json({error:'Item is missing or already transferred to inventory.'});}
            ({rows:[item]}=await client.query(`UPDATE pre_inventory SET name=$1,category=$2,brand=$3,reference=$4,cost_price=$5,selling_price=$6,quantity=$7,commission=$8,commission_user_id=$9 WHERE id=$10 RETURNING *`,[b.name.trim(),b.category||null,b.brand||null,b.reference||null,b.cost_price,b.selling_price,b.quantity,b.commission??0,b.commission_user_id??null,req.params.id]));
            await client.query('DELETE FROM pre_inventory_allocations WHERE pre_inventory_id=$1',[item.id]);
        } else {
            ({rows:[item]}=await client.query(`INSERT INTO pre_inventory (name,category,brand,reference,cost_price,selling_price,quantity,created_by,commission,commission_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[b.name.trim(),b.category||null,b.brand||null,b.reference||null,b.cost_price,b.selling_price,b.quantity,req.user.id,b.commission??0,b.commission_user_id??null]));
        }
        for(const a of b.allocations) await client.query('INSERT INTO pre_inventory_allocations (pre_inventory_id,shop_id,quantity) VALUES ($1,$2,$3)',[item.id,a.shop_id,a.quantity]);
        await client.query('COMMIT');res.status(req.params.id?200:201).json(item);
    } catch(err) {
        if(client) await client.query('ROLLBACK');
        if(err.code==='23503') return res.status(400).json({error:'A selected shop or commission recipient no longer exists.'});
        next(err);
    } finally {if(client)client.release();}
}
router.post('/',save);
router.put('/:id',save);
router.post('/:id/receive',async(req,res,next)=>{
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({error:'Invalid pre-inventory item.'});
    let client;
    try {
        client=await pool.connect();await client.query('BEGIN');
        const {rows:[item]}=await client.query('SELECT * FROM pre_inventory WHERE id=$1 FOR UPDATE',[req.params.id]);
        if(!item || item.received_at){await client.query('ROLLBACK');return res.status(409).json({error:'Item is missing or already transferred. Stock has not been added again.'});}
        const {rows:allocations}=await client.query('SELECT * FROM pre_inventory_allocations WHERE pre_inventory_id=$1 ORDER BY shop_id',[item.id]);
        if(!allocations.length || allocations.reduce((sum,a)=>sum+a.quantity,0)!==item.quantity) throw new Error('Invalid saved allocations');
        for(const a of allocations){
            const {rows:[product]}=await client.query(`INSERT INTO products (name,category,brand,cost_price,selling_price,quantity,shop_id,icon,commission,commission_user_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[item.name,item.category,item.brand,item.cost_price,item.selling_price,a.quantity,a.shop_id,'\u{1F4E6}',item.commission??0,item.commission_user_id??null]);
            await client.query(`INSERT INTO stock_movements (product_id,type,qty_change,balance_after,note,user_id) VALUES ($1,'initial',$2,$2,$3,$4)`,[product.id,a.quantity,'Received from pre-inventory #'+item.id,req.user.id]);
            await client.query('UPDATE pre_inventory_allocations SET product_id=$1 WHERE id=$2',[product.id,a.id]);
        }
        await client.query('UPDATE pre_inventory SET received_at=NOW(), received_by=$1 WHERE id=$2',[req.user.id,item.id]);
        await client.query('COMMIT');res.json({message:'Goods transferred to each allocated shop.',id:item.id});
    } catch(err){if(client)await client.query('ROLLBACK');next(err);}
    finally {if(client)client.release();}
});
module.exports=router;
