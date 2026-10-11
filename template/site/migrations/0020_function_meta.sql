
DROP TRIGGER IF EXISTS money_function_refund_insert;
CREATE TRIGGER money_function_refund_insert AFTER INSERT ON meta
WHEN CASE WHEN NEW.key LIKE 'shop-money:%:refund:%' AND json_valid(NEW.value)
THEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='payment.refunded')
 AND json_extract(NEW.value,'$.status')='succeeded'
 AND NOT EXISTS (SELECT 1 FROM studio_events WHERE id='refund:' || json_extract(NEW.value,'$.id'))
ELSE 0 END BEGIN
 INSERT OR IGNORE INTO studio_events(id,type,data,at)
 SELECT 'refund:' || json_extract(NEW.value,'$.id'),'payment.refunded',
 json_object('refund',json_extract(NEW.value,'$.id'),'payment',json_extract(NEW.value,'$.payment_intent'),'amount',json_extract(NEW.value,'$.amount'),'currency',json_extract(NEW.value,'$.currency')),json_extract(NEW.value,'$.at')*1000;
END;

DROP TRIGGER IF EXISTS money_function_refund_update;
CREATE TRIGGER money_function_refund_update AFTER UPDATE ON meta
WHEN CASE WHEN NEW.key LIKE 'shop-money:%:refund:%' AND json_valid(NEW.value)
THEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='payment.refunded')
 AND json_extract(NEW.value,'$.status')='succeeded'
 AND NOT EXISTS (SELECT 1 FROM studio_events WHERE id='refund:' || json_extract(NEW.value,'$.id'))
ELSE 0 END BEGIN
 INSERT OR IGNORE INTO studio_events(id,type,data,at)
 SELECT 'refund:' || json_extract(NEW.value,'$.id'),'payment.refunded',
 json_object('refund',json_extract(NEW.value,'$.id'),'payment',json_extract(NEW.value,'$.payment_intent'),'amount',json_extract(NEW.value,'$.amount'),'currency',json_extract(NEW.value,'$.currency')),json_extract(NEW.value,'$.at')*1000;
END;