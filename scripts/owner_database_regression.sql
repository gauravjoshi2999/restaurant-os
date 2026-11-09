-- Substitute the three __...__ fixture identifiers before running.
-- Every business write is rolled back inside the nested test block.
-- Only use a dedicated unpublished QA restaurant and a non-Admin QA Owner.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"__OWNER_ID__","role":"authenticated"}', true);
DO $test$
DECLARE
  rid uuid := '__RESTAURANT_ID__';
  uid uuid := '__OWNER_ID__';
  foreign_rid uuid := '__FOREIGN_RESTAURANT_ID__';
  cat uuid; item uuid; expense uuid; customer uuid; stock uuid; supplier uuid;
  employee uuid; attendance uuid; leave_id uuid; table_id uuid; purchase uuid;
  result jsonb := '[]'; value numeric; count_rows integer;
BEGIN
  BEGIN
    IF public.is_platform_admin() THEN RAISE EXCEPTION 'QA Owner must not be Admin'; END IF;
    IF (SELECT count(*) FROM public.restaurants WHERE id=rid)<>1 THEN RAISE EXCEPTION 'Own restaurant read failed'; END IF;
    IF EXISTS(SELECT FROM public.restaurants WHERE id=foreign_rid) THEN RAISE EXCEPTION 'Foreign restaurant exposed'; END IF;
    IF EXISTS(SELECT FROM public.restaurant_cashbook_entries WHERE restaurant_id<>rid)
      OR EXISTS(SELECT FROM public.restaurant_customer_balances WHERE restaurant_id<>rid)
      OR EXISTS(SELECT FROM public.restaurant_inventory_balances WHERE restaurant_id<>rid)
      THEN RAISE EXCEPTION 'A view bypassed tenant isolation'; END IF;
    BEGIN
      INSERT INTO public.menu_items(restaurant_id,name,price) VALUES(foreign_rid,'Forbidden QA write',1);
      RAISE EXCEPTION 'Foreign menu insert was allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    result := result || '"Owner isolation: tables, views and foreign write denial"';

    INSERT INTO public.menu_categories(restaurant_id,name) VALUES(rid,'QA category') RETURNING id INTO cat;
    INSERT INTO public.menu_items(restaurant_id,category_id,name,price) VALUES(rid,cat,'QA meal',100) RETURNING id INTO item;
    UPDATE public.menu_items SET price=125,is_available=false WHERE id=item;
    IF NOT EXISTS(SELECT FROM public.menu_items WHERE id=item AND price=125 AND NOT is_available) THEN RAISE EXCEPTION 'Menu update failed'; END IF;
    DELETE FROM public.menu_items WHERE id=item;
    DELETE FROM public.menu_categories WHERE id=cat;
    result := result || '"Menu category/item create, update, availability and delete"';

    INSERT INTO public.restaurant_tables(restaurant_id,table_name,seats) VALUES(rid,'QA table',4) RETURNING id INTO table_id;
    UPDATE public.restaurant_tables SET seats=6,is_active=false WHERE id=table_id;
    IF NOT EXISTS(SELECT FROM public.restaurant_tables WHERE id=table_id AND seats=6 AND NOT is_active) THEN RAISE EXCEPTION 'Table edit failed'; END IF;
    result := result || '"Table create, seating update and deactivate"';

    INSERT INTO public.restaurant_expenses(restaurant_id,expense_date,category,title,amount,payment_method)
      VALUES(rid,current_date,'Rent','QA expense',100,'Cash') RETURNING id INTO expense;
    UPDATE public.restaurant_expenses SET amount=125 WHERE id=expense;
    IF NOT EXISTS(SELECT FROM public.restaurant_cashbook_entries WHERE source_id=expense AND amount=125) THEN RAISE EXCEPTION 'Expense cashbook sync failed'; END IF;
    result := result || '"Expense create/edit and automatic cashbook sync"';

    INSERT INTO public.restaurant_customers(restaurant_id,full_name,phone) VALUES(rid,'QA Khata customer','9999999909') RETURNING id INTO customer;
    INSERT INTO public.restaurant_customer_ledger_entries(restaurant_id,customer_id,entry_type,amount)
      VALUES(rid,customer,'debit',200);
    INSERT INTO public.restaurant_customer_ledger_entries(restaurant_id,customer_id,entry_type,amount,payment_method)
      VALUES(rid,customer,'credit',50,'Cash');
    SELECT balance INTO value FROM public.restaurant_customer_balances WHERE customer_id=customer;
    IF value<>150 THEN RAISE EXCEPTION 'Khata balance expected 150, got %',value; END IF;
    result := result || '"Khata customer, udhar, collection and balance"';

    INSERT INTO public.restaurant_cashbook_manual_entries(restaurant_id,direction,category,amount,payment_method)
      VALUES(rid,'in','QA miscellaneous income',20,'Cash');
    result := result || '"Cashbook manual income and payment-mode totals"';

    INSERT INTO public.restaurant_inventory_items(restaurant_id,name,unit,reorder_level)
      VALUES(rid,'QA rice','kg',2) RETURNING id INTO stock;
    INSERT INTO public.restaurant_stock_movements(restaurant_id,inventory_item_id,movement_type,quantity)
      VALUES(rid,stock,'opening',10);
    INSERT INTO public.restaurant_suppliers(restaurant_id,name) VALUES(rid,'QA supplier') RETURNING id INTO supplier;
    SELECT public.save_restaurant_purchase(rid,null,
      jsonb_build_object('supplier_id',supplier,'supplier_name_snapshot','QA supplier','purchase_date',current_date,'total_amount',100,'paid_amount',40,'payment_method','Cash'),
      jsonb_build_array(jsonb_build_object('item_name','QA rice','quantity',2,'unit_cost',50,'inventory_item_id',stock,'unit','kg'))) INTO purchase;
    INSERT INTO public.restaurant_stock_movements(restaurant_id,inventory_item_id,movement_type,quantity)
      VALUES(rid,stock,'wastage',3);
    SELECT current_stock INTO value FROM public.restaurant_inventory_balances WHERE inventory_item_id=stock;
    IF value<>9 THEN RAISE EXCEPTION 'Expected inventory 9, got %',value; END IF;
    BEGIN
      INSERT INTO public.restaurant_stock_movements(restaurant_id,inventory_item_id,movement_type,quantity) VALUES(rid,stock,'wastage',100);
      RAISE EXCEPTION 'Negative inventory was allowed';
    EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
      IF SQLERRM='Negative inventory was allowed' THEN RAISE; END IF;
    END;
    result := result || '"Supplier, purchase, partial payment, stock posting and negative-stock guard"';

    INSERT INTO public.restaurant_employees(restaurant_id,full_name,salary_amount) VALUES(rid,'QA team member',1000) RETURNING id INTO employee;
    UPDATE public.restaurant_employees SET position='Cook' WHERE id=employee;
    INSERT INTO public.restaurant_employee_attendance(restaurant_id,employee_id,attendance_date,status)
      VALUES(rid,employee,current_date,'Present') RETURNING id INTO attendance;
    UPDATE public.restaurant_employee_attendance SET status='Half Day' WHERE id=attendance;
    INSERT INTO public.restaurant_employee_leaves(restaurant_id,employee_id,leave_type,start_date,end_date)
      VALUES(rid,employee,'Casual',current_date+1,current_date+1) RETURNING id INTO leave_id;
    UPDATE public.restaurant_employee_leaves SET status='Approved',approved_by=uid,approved_at=now() WHERE id=leave_id;
    INSERT INTO public.restaurant_employee_payments(restaurant_id,employee_id,payment_type,amount,payment_method)
      VALUES(rid,employee,'Salary',100,'Cash');
    IF NOT EXISTS(SELECT FROM public.restaurant_cashbook_entries WHERE source_type='employee_payment' AND amount=100) THEN RAISE EXCEPTION 'Salary cashbook sync failed'; END IF;
    result := result || '"Employee create/edit, attendance, leave approval and salary cashbook posting"';

    UPDATE public.restaurants SET default_delivery_fee=41,minimum_order_amount=160,opening_time='10:45',closing_time='22:45',delivery_paused=true WHERE id=rid;
    IF NOT EXISTS(SELECT FROM public.restaurants WHERE id=rid AND default_delivery_fee=41 AND delivery_paused) THEN RAISE EXCEPTION 'Settings write failed'; END IF;
    BEGIN
      UPDATE public.restaurants SET platform_commission_rate=0 WHERE id=rid;
      RAISE EXCEPTION 'Owner changed protected commission';
    EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
      IF SQLERRM='Owner changed protected commission' THEN RAISE; END IF;
    END;
    result := result || '"Settings, operating hours, delivery pause and protected commission denial"';

    PERFORM public.close_restaurant_cashbook_day(rid,current_date,1000,805,'QA closing');
    SELECT expected_cash INTO value FROM public.restaurant_cashbook_closings WHERE restaurant_id=rid AND close_date=current_date;
    IF value<>805 THEN RAISE EXCEPTION 'Closing expected 805, got %',value; END IF;
    BEGIN
      INSERT INTO public.restaurant_cashbook_manual_entries(restaurant_id,direction,category,amount,payment_method)
        VALUES(rid,'in','Forbidden closed-day entry',1,'Cash');
      RAISE EXCEPTION 'Closed day accepted another entry';
    EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
      IF SQLERRM='Closed day accepted another entry' THEN RAISE; END IF;
    END;
    result := result || '"Cashbook reconciliation across modules and closed-day write guard"';
    RAISE SQLSTATE 'ZX001' USING MESSAGE='Rollback successful QA business writes';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    -- The nested transaction has now rolled back every inserted business row.
    PERFORM set_config('bite.qa.owner_result',result::text,false);
  END;
END $test$;
COMMIT;
SELECT current_setting('bite.qa.owner_result')::jsonb AS passed_checks;
