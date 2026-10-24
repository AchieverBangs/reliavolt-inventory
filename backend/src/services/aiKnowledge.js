const pool = require('../db/pool');

// Explicit business-data boundary. New features register here at implementation time;
// no user instruction is needed to refresh their data or discover new safe columns.
const BUSINESS_TABLES = new Set([
    'shops', 'users', 'products', 'customers', 'sales', 'issued_receipt_numbers',
    'credit_payments', 'credit_payment_allocations', 'stock_movements',
    'commission_settlements', 'activity_log', 'login_history', 'deliveries',
    'delivery_items', 'settings', 'app_updates', 'expenditures', 'deposits',
    'pre_inventory', 'pre_inventory_allocations', 'role_permissions'
]);
const SAFE_USER_COLUMNS = new Set(['id','name','role','shop_id','status','can_write','created_at','last_login']);
const SECRET = /password|secret|token|credential|api_key|private_key|receipt_data|session|connection_string/i;
const SAFE_TYPES = new Set(['integer','bigint','smallint','numeric','real','double precision','boolean','text','character varying','date','timestamp without time zone','timestamp with time zone']);
const NUMERIC_TYPES = new Set(['integer','bigint','smallint','numeric','real','double precision']);
const quote = name => '"' + name.replaceAll('"','""') + '"';
function requireAdmin(user) {
    if (user?.role !== 'Admin') throw new Error('Company-wide knowledge is available only to Admin accounts.');
}
async function catalog(user) {
    requireAdmin(user);
    const {rows} = await pool.query(`SELECT c.table_name, c.column_name, c.data_type
        FROM information_schema.columns c JOIN information_schema.tables t
          ON t.table_schema=c.table_schema AND t.table_name=c.table_name
        WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
        ORDER BY c.table_name,c.ordinal_position`);
    const tables = {};
    for (const row of rows) {
        if (!BUSINESS_TABLES.has(row.table_name) || SECRET.test(row.column_name) || !SAFE_TYPES.has(row.data_type)) continue;
        if (row.table_name === 'users' && !SAFE_USER_COLUMNS.has(row.column_name)) continue;
        (tables[row.table_name] ||= []).push({name:row.column_name,type:row.data_type});
    }
    return tables;
}
const tools = [
    {name:'get_business_catalog',description:'Discover the current business modules and safe fields, including deposits, expenditure, incoming pre-inventory, allocations, commissions, settings and historical records. Refreshed from the live schema, not a cached training snapshot.',input_schema:{type:'object',properties:{}}},
    {name:'query_business_records',description:'Read current or historical business records, or calculate exact totals grouped by shop, product or staff. Use the live catalog for table/column names. No arbitrary SQL or writes. For complete totals use sum_columns/count rather than adding a limited page of rows. Results include IDs for cross-referencing shops, products and users.',input_schema:{
        type:'object',properties:{
            table:{type:'string'},columns:{type:'array',items:{type:'string'},maxItems:20},
            filters:{type:'array',maxItems:10,items:{type:'object',properties:{column:{type:'string'},op:{type:'string',enum:['eq','gte','lte','contains','is_null','not_null']},value:{type:['string','number','boolean']}},required:['column','op']}},
            sum_columns:{type:'array',items:{type:'string'},maxItems:8},count:{type:'boolean'},group_by:{type:'string'},
            order_by:{type:'string'},descending:{type:'boolean'},limit:{type:'integer',minimum:1,maximum:50},offset:{type:'integer',minimum:0,maximum:100000}
        },required:['table']
    }}
];
async function queryRecords(input,user) {
    requireAdmin(user);
    const tables = await catalog(user);
    const fields = tables[input.table];
    if (!fields) throw new Error('Business table is not available. Use the business catalog.');
    const field = name => {
        const found = fields.find(f=>f.name===name);
        if (!found) throw new Error('Field is not available: '+String(name));
        return found;
    };
    const sums = input.sum_columns ?? [];
    const columns = input.columns ?? fields.slice(0,20).map(f=>f.name);
    const filters = input.filters ?? [];
    if(!Array.isArray(sums)||sums.length>8||!Array.isArray(columns)||!columns.length||columns.length>20||!Array.isArray(filters)||filters.length>10) throw new Error('Invalid query options.');
    const aggregate = !!input.count || sums.length>0;
    if(input.group_by&&!aggregate)throw new Error('Grouping requires count or sum_columns.');
    const selected=[];
    if(aggregate){
        if(input.group_by){field(input.group_by);selected.push(quote(input.group_by));}
        selected.push('COUNT(*)::text AS record_count');
        for(const column of sums){if(!NUMERIC_TYPES.has(field(column).type))throw new Error('Only numeric columns can be summed.');selected.push('COALESCE(SUM('+quote(column)+'),0)::text AS '+quote('sum_'+column));}
    }else for(const column of columns){field(column);selected.push(quote(column));}
    const values=[],conditions=[];
    for(const filter of filters){
        if(!filter||typeof filter!=='object')throw new Error('Invalid filter.');
        field(filter.column);const column=quote(filter.column);
        if(['is_null','not_null'].includes(filter.op)){conditions.push(column+(filter.op==='is_null'?' IS NULL':' IS NOT NULL'));continue;}
        const op={eq:'=',gte:'>=',lte:'<='}[filter.op];
        if(!op&&filter.op!=='contains')throw new Error('Invalid filter operation.');
        if(!['string','number','boolean'].includes(typeof filter.value))throw new Error('Invalid filter value.');
        values.push(filter.op==='contains'?'%'+String(filter.value).slice(0,500)+'%':filter.value);
        conditions.push(filter.op==='contains'?column+'::text ILIKE $'+values.length:column+op+'$'+values.length);
    }
    let sql='SELECT '+selected.join(', ')+' FROM public.'+quote(input.table);
    if(conditions.length)sql+=' WHERE '+conditions.join(' AND ');
    if(aggregate&&input.group_by)sql+=' GROUP BY '+quote(input.group_by);
    if(input.order_by){field(input.order_by);if(aggregate&&input.order_by!==input.group_by)throw new Error('Aggregate ordering must use the grouped column.');sql+=' ORDER BY '+quote(input.order_by)+(input.descending?' DESC':' ASC')+' NULLS LAST';}
    else if(!aggregate&&fields.some(f=>f.name==='id'))sql+=' ORDER BY "id" DESC';
    const limit=Number.isInteger(input.limit)?Math.max(1,Math.min(input.limit,50)):30;
    const offset=Number.isInteger(input.offset)?Math.max(0,Math.min(input.offset,100000)):0;
    values.push(limit+1,offset);sql+=' LIMIT $'+(values.length-1)+' OFFSET $'+values.length;
    const {rows}=await pool.query(sql,values);
    return {table:input.table,rows:rows.slice(0,limit).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='string'?value.slice(0,2000):value]))),has_more:rows.length>limit,offset,limit,queried_at:new Date().toISOString()};
}
async function context(user) {
    const tables=await catalog(user);
    const result={refreshed_at:new Date().toISOString(),catalog:tables};
    if(tables.activity_log){const {rows}=await pool.query('SELECT action,entity_type,description,created_at FROM activity_log ORDER BY id DESC LIMIT 8');result.recent_changes=rows;}
    if(tables.app_updates){const {rows}=await pool.query('SELECT title,body,created_at FROM app_updates ORDER BY id DESC LIMIT 5');result.feature_announcements=rows;}
    return result;
}
async function run(name,input,user){
    requireAdmin(user);
    if(name==='get_business_catalog')return catalog(user);
    if(name==='query_business_records')return queryRecords(input,user);
    throw new Error('Unknown knowledge tool.');
}
module.exports={tools,context,run,catalog,queryRecords};
