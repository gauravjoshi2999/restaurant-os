-- Additive POS diner-count metadata. Old orders are never backfilled or guessed.
-- Created in the very same transaction as the canonical POS sale.
CREATE TABLE IF NOT EXISTS public.bite_pos_bill_service (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE RESTRICT,
 restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
 service_type text NOT NULL CHECK (service_type IN ('dine_in','takeaway')),
 guest_count integer,
 table_id uuid REFERENCES public.restaurant_tables(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (
   (service_type='dine_in' AND guest_count BETWEEN 1 AND 100)
   OR (service_type='takeaway' AND guest_count IS NULL AND table_id IS NULL)
 )
);
CREATE INDEX IF NOT EXISTS bite_pos_bill_service_restaurant_idx
 ON public.bite_pos_bill_service(restaurant_id,created_at DESC);
ALTER TABLE public.bite_pos_bill_service ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bite_pos_bill_service FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.bite_pos_bill_service TO authenticated;
DROP POLICY IF EXISTS bite_pos_bill_service_read ON public.bite_pos_bill_service;
CREATE POLICY bite_pos_bill_service_read ON public.bite_pos_bill_service
 FOR SELECT TO authenticated
 USING (public.has_restaurant_role(restaurant_id,ARRAY['owner','manager','staff']::text[]));

CREATE OR REPLACE FUNCTION public.bite_create_pos_bill_with_service_v1(
 p_restaurant_id uuid,
 p_order_code text,
 p_customer_name text,
 p_customer_phone text,
 p_items jsonb,
 p_paid_amount numeric,
 p_payment_method text,
 p_payment_date date,
 p_reference text,
 p_balance_action text,
 p_writeoff_reason text,
 p_service_type text,
 p_guest_count integer,
 p_table_id uuid DEFAULT NULL,
 p_original_order_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
 v_order_id uuid;
 v_total numeric(14,2);
 v_customer_id uuid;
 v_due numeric(14,2);
 v_channel text;
BEGIN
 IF auth.uid() IS NULL
    OR NOT public.has_restaurant_role(p_restaurant_id,ARRAY['owner','manager']::text[]) THEN
  RAISE EXCEPTION 'Authorized restaurant owner or manager required' USING errcode='42501';
 END IF;
 IF p_service_type NOT IN ('dine_in','takeaway') OR p_service_type IS NULL THEN
  RAISE EXCEPTION 'Select Dine-in or Takeaway';
 END IF;
 IF p_service_type='dine_in' AND (p_guest_count IS NULL OR p_guest_count NOT BETWEEN 1 AND 100) THEN
  RAISE EXCEPTION 'Dine-in guest count must be between 1 and 100';
 END IF;
 IF p_service_type='takeaway' AND (p_guest_count IS NOT NULL OR p_table_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Takeaway cannot have seated guest count or table';
 END IF;
 IF p_table_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.restaurant_tables t WHERE t.id=p_table_id
    AND t.restaurant_id=p_restaurant_id AND t.is_active=true
 ) THEN RAISE EXCEPTION 'Select an active table belonging to your restaurant' USING errcode='42501'; END IF;
 IF p_balance_action NOT IN ('none','udhar','waive_off') OR p_balance_action IS NULL THEN
  RAISE EXCEPTION 'Select a valid remaining balance action';
 END IF;
 IF p_original_order_id IS NOT NULL THEN
  -- Preserve the existing protected correction/void rule for old counter bills.
  v_order_id:=public.replace_unpaid_pos_order(
   p_original_order_id,p_restaurant_id,p_order_code,p_customer_name,p_customer_phone,
   p_items,p_paid_amount,p_payment_method,p_payment_date,p_reference,p_balance_action,p_writeoff_reason);
 ELSE
  IF p_balance_action='udhar' THEN
   IF nullif(trim(p_customer_name),'') IS NULL OR nullif(trim(p_customer_phone),'') IS NULL THEN
    RAISE EXCEPTION 'Udhar needs a customer name and phone';
   END IF;
   SELECT c.id INTO v_customer_id FROM public.restaurant_customers c
    WHERE c.restaurant_id=p_restaurant_id
      AND c.phone_normalized=public.normalize_indian_phone(p_customer_phone)
      AND c.status='Active' LIMIT 1;
   IF v_customer_id IS NULL THEN
    INSERT INTO public.restaurant_customers(restaurant_id,full_name,phone,created_by)
      VALUES(p_restaurant_id,trim(p_customer_name),trim(p_customer_phone),auth.uid())
      RETURNING id INTO v_customer_id;
   END IF;
  END IF;
  v_channel:=CASE WHEN p_service_type='dine_in' THEN 'POS - Dine-in' ELSE 'POS - Takeaway' END;
  v_order_id:=public.create_pos_order_with_payment(
   p_restaurant_id,p_order_code,v_channel,p_customer_name,p_customer_phone,
   p_items,coalesce(p_paid_amount,0),p_payment_method,coalesce(p_payment_date,current_date),
   p_reference,p_table_id);
  SELECT o.amount,o.restaurant_customer_id INTO v_total,v_customer_id FROM public.orders o
   WHERE o.id=v_order_id AND o.restaurant_id=p_restaurant_id;
  v_due:=round(v_total-coalesce(p_paid_amount,0),2);
  IF v_due>0 AND p_balance_action='udhar' AND v_customer_id IS NULL THEN
   RAISE EXCEPTION 'Customer Khata link failed; sale not recorded';
  ELSIF v_due>0 AND p_balance_action='waive_off' THEN
   UPDATE public.orders SET waived_off_amount=v_due
    WHERE id=v_order_id AND restaurant_id=p_restaurant_id;
  ELSIF v_due>0 AND p_balance_action='none' THEN
   RAISE EXCEPTION 'Select Udhar or Waive-off for remaining balance';
  END IF;
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id=v_order_id AND o.restaurant_id=p_restaurant_id
    AND o.channel LIKE 'POS - %' AND o.is_demo=false AND o.created_by=auth.uid()
 ) THEN RAISE EXCEPTION 'POS bill identity mismatch' USING errcode='42501'; END IF;
 INSERT INTO public.bite_pos_bill_service(order_id,restaurant_id,service_type,guest_count,table_id)
 VALUES(v_order_id,p_restaurant_id,p_service_type,
        CASE WHEN p_service_type='dine_in' THEN p_guest_count END,
        CASE WHEN p_service_type='dine_in' THEN p_table_id END);
 RETURN v_order_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.bite_create_pos_bill_with_service_v1(
 uuid,text,text,text,jsonb,numeric,text,date,text,text,text,text,integer,uuid,uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bite_create_pos_bill_with_service_v1(
 uuid,text,text,text,jsonb,numeric,text,date,text,text,text,text,integer,uuid,uuid)
 TO authenticated;

-- Property managers and cashiers use a different, idempotent property-command
-- path. Its existing order and payment remain untouched; the command journal
-- trigger records guest count in the SAME committed transaction.
CREATE OR REPLACE FUNCTION private.bite_pos_service_from_property_command()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_order uuid;v_rid uuid;v_type text;v_guests integer;v_table uuid;
BEGIN
 IF NEW.action<>'pos_sale' OR NOT (NEW.payload ? 'service_type') THEN RETURN NEW; END IF;
 v_order:=NULLIF(NEW.result->>'order_id','')::uuid;
 v_rid:=NULLIF(NEW.payload->>'restaurant_id','')::uuid;
 v_type:=NEW.payload->>'service_type';
 v_guests:=NULLIF(NEW.payload->>'guest_count','')::integer;
 v_table:=NULLIF(NEW.payload->>'table_id','')::uuid;
 IF v_order IS NULL OR v_rid IS NULL OR v_type NOT IN ('dine_in','takeaway')
    OR NOT EXISTS (
      SELECT 1 FROM public.orders o WHERE o.id=v_order AND o.restaurant_id=v_rid
      AND o.created_by=NEW.created_by AND o.is_demo=false
      AND o.channel=CASE WHEN v_type='dine_in' THEN 'POS - Dine-in' ELSE 'POS - Takeaway' END
    ) THEN RAISE EXCEPTION 'POS property command identity/type mismatch'; END IF;
 IF v_type='dine_in' AND (v_guests IS NULL OR v_guests NOT BETWEEN 1 AND 100) THEN
  RAISE EXCEPTION 'Enter valid dine-in people count';
 END IF;
 IF v_type='takeaway' AND (v_guests IS NOT NULL OR v_table IS NOT NULL) THEN
  RAISE EXCEPTION 'Takeaway cannot include diner count or table';
 END IF;
 INSERT INTO public.bite_pos_bill_service(order_id,restaurant_id,service_type,guest_count,table_id)
 VALUES(v_order,v_rid,v_type,v_guests,v_table);
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.bite_pos_service_from_property_command() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS bite_pos_service_after_property_command ON public.bite_property_commands;
CREATE TRIGGER bite_pos_service_after_property_command
 AFTER INSERT ON public.bite_property_commands
 FOR EACH ROW EXECUTE FUNCTION private.bite_pos_service_from_property_command();
