/** Durable outbox: source changes and their events commit in the same D1 transaction. */
export const FUNCTIONS_MIGRATION_FILE = '0018_studio_functions.sql';
export const FUNCTIONS_MIGRATION = `
CREATE TABLE customer_offers(id TEXT PRIMARY KEY,kind TEXT NOT NULL,manifest TEXT NOT NULL);
CREATE TABLE service_results(order_id TEXT PRIMARY KEY,state TEXT NOT NULL,lease TEXT,due INTEGER NOT NULL,result TEXT);
CREATE TABLE studio_events (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE TABLE function_deliveries (
 event TEXT NOT NULL, function TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0,
 lease TEXT, error TEXT, completed INTEGER, PRIMARY KEY(event,function)
);
CREATE INDEX function_deliveries_due ON function_deliveries(state,due);
${['shop_orders','purchase_orders'].map(table=>`
CREATE TRIGGER ${table}_function_paid AFTER UPDATE ON ${table}
WHEN OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL ${table==='shop_orders'?"AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id=NEW.id)":''} BEGIN
 INSERT OR IGNORE INTO studio_events VALUES('${table}:' || NEW.id || ':paid','order.paid',json_object('order',NEW.id,'source','${table}','amount',NEW.amount,'currency',NEW.currency,'mode',NEW.mode),NEW.paid_at);
END;
CREATE TRIGGER ${table}_function_refund AFTER UPDATE ON ${table}
WHEN OLD.status != 'refunded' AND NEW.status = 'refunded' ${table==='shop_orders'?"AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id=NEW.id)":''} BEGIN
 INSERT OR IGNORE INTO studio_events VALUES('${table}:' || NEW.id || ':refund:' || COALESCE(NEW.refund,''),'order.refunded',json_object('order',NEW.id,'source','${table}','refund',NEW.refund,'mode',NEW.mode),NEW.updated_at);
END;`).join('\n')}
${['INSERT','UPDATE','DELETE'].map(op=>{const row=op==='DELETE'?'OLD':'NEW';return `
CREATE TRIGGER app_records_function_${op.toLowerCase()} AFTER ${op} ON app_records BEGIN
 INSERT INTO studio_events VALUES(lower(hex(randomblob(16))),'record.changed',json_object('app',${row}.app,'collection',${row}.collection,'record',${row}.id,'version',${row}.version,'operation','${op.toLowerCase()}','data',json(${row}.value)),${row}.updated_at);
END;`;}).join('\n')}
${['INSERT','UPDATE'].map(op=>`
CREATE TRIGGER money_function_refund_${op.toLowerCase()} AFTER ${op} ON meta
WHEN NEW.key LIKE 'shop-money:%:refund:%' AND json_extract(NEW.value,'$.status')='succeeded'
AND NOT EXISTS (SELECT 1 FROM studio_events WHERE id='refund:' || json_extract(NEW.value,'$.id')) BEGIN
 INSERT OR IGNORE INTO studio_events
 SELECT 'refund:' || json_extract(NEW.value,'$.id'),'payment.refunded',
 json_object('refund',json_extract(NEW.value,'$.id'),'payment',json_extract(NEW.value,'$.payment_intent'),'amount',json_extract(NEW.value,'$.amount'),'currency',json_extract(NEW.value,'$.currency')),json_extract(NEW.value,'$.at')*1000;
END;`).join('\n')}
CREATE TRIGGER mcp_function_call AFTER INSERT ON mcp_audit WHEN NEW.outcome = 'ok' BEGIN
 INSERT INTO studio_events VALUES('tool:' || NEW.id,'tool.called',json_object('tool',NEW.tool,'person',NEW.person,'client',NEW.client),NEW.at);
END;
`;
