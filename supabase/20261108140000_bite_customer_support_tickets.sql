-- Customer support tickets, tenant isolation, Admin handling and audit events.
CREATE TABLE IF NOT EXISTS public.customer_support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('Order','Payment','Account','Restaurant','Other')),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 3 AND 120),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 10 AND 2000),
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Resolved','Closed')),
  admin_response text CHECK (admin_response IS NULL OR length(admin_response)<=2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS customer_support_tickets_customer_created_idx ON public.customer_support_tickets(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS customer_support_tickets_status_created_idx ON public.customer_support_tickets(status,created_at DESC);
ALTER TABLE public.customer_support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers and admins read support tickets" ON public.customer_support_tickets FOR SELECT TO authenticated
  USING (customer_id=(SELECT auth.uid()) OR public.is_platform_admin());
CREATE POLICY "Customers create own support tickets" ON public.customer_support_tickets FOR INSERT TO authenticated
  WITH CHECK (customer_id=(SELECT auth.uid()) AND (order_id IS NULL OR EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id=customer_support_tickets.order_id AND o.customer_id=(SELECT auth.uid())
  )));
CREATE POLICY "Platform admins update support tickets" ON public.customer_support_tickets FOR UPDATE TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
GRANT SELECT,INSERT,UPDATE ON public.customer_support_tickets TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_support_ticket_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at:=now();
  IF NEW.status IN ('Resolved','Closed') AND OLD.status NOT IN ('Resolved','Closed') THEN NEW.resolved_at:=now();
  ELSIF NEW.status NOT IN ('Resolved','Closed') THEN NEW.resolved_at:=NULL; END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_touch_support_ticket_updated_at BEFORE UPDATE ON public.customer_support_tickets
FOR EACH ROW EXECUTE FUNCTION public.touch_support_ticket_updated_at();

CREATE OR REPLACE FUNCTION public.audit_support_ticket_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_action text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    v_action:='customer_support_ticket_created';
    INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
    VALUES(auth.uid(),v_action,'customer_support_ticket',NEW.id,jsonb_build_object('category',NEW.category,'subject',NEW.subject,'status',NEW.status,'order_id',NEW.order_id));
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.admin_response IS DISTINCT FROM OLD.admin_response THEN
    v_action:='customer_support_ticket_updated';
    INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,details)
    VALUES(auth.uid(),v_action,'customer_support_ticket',NEW.id,jsonb_build_object('old_status',OLD.status,'new_status',NEW.status,'response_changed',NEW.admin_response IS DISTINCT FROM OLD.admin_response));
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_audit_support_ticket_change AFTER INSERT OR UPDATE ON public.customer_support_tickets
FOR EACH ROW EXECUTE FUNCTION public.audit_support_ticket_change();
REVOKE ALL ON FUNCTION public.touch_support_ticket_updated_at() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.audit_support_ticket_change() FROM PUBLIC,anon,authenticated;
