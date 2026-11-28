-- Guest entry keeps Rooms, Guest Register and Reservations. Financial access
-- remains explicit. Stored grants and fallback permissions for legacy logins stay intact.
DO $migration$
DECLARE
  definition text;
  bundled text := $rule$if perms&&array['guest_entry','reservation_entry','checkin','stay_manage'] then perms:=perms||array['hotel_rooms','guest_register','reservations','folios'];end if;$rule$;
  separated text := $rule$if perms&&array['guest_entry','reservation_entry','checkin','stay_manage'] then perms:=perms||array['hotel_rooms','guest_register','reservations'];end if;$rule$;
  family_gate text := $rule$or not private.bite_can(p_property,'folios') then$rule$;
  new_family_gate text := $rule$or (not private.bite_can(p_property,'folios')
      and not private.bite_staff_can(p_property,'reservation_entry')) then$rule$;
BEGIN
  definition := pg_get_functiondef('private.bite_save_staff_access(uuid,uuid,text,text,boolean,text[])'::regprocedure);
  IF (length(definition)-length(replace(definition,bundled,'')))/length(bundled)<>1 THEN
    RAISE EXCEPTION 'Staff access implementation changed. Reconcile the guest entry migration.';
  END IF;
  EXECUTE replace(definition,bundled,separated);

  definition := pg_get_functiondef('public.bite_family_booking(uuid,jsonb,uuid)'::regprocedure);
  IF (length(definition)-length(replace(definition,family_gate,'')))/length(family_gate)<>1 THEN
    RAISE EXCEPTION 'Family reservation guard changed. Reconcile the guest entry migration.';
  END IF;
  -- Inner reserve/check-in commands still enforce their own permissions,
  -- including payment and verification for any accompanying advance.
  EXECUTE replace(definition,family_gate,new_family_gate);
END;
$migration$;

-- Historical records already have an owner/manager policy. Narrow it with the
-- matching financial permission, for both reads (including exports) and entry.
CREATE POLICY bite_historical_financial_scope ON public.bite_owner_historical_entries
AS RESTRICTIVE FOR ALL TO authenticated
USING (
 (entry_kind='room' AND private.bite_can(property_id,'folios'))
 OR (entry_kind='pos' AND private.bite_restaurant_staff_can(restaurant_id,'restaurant_pos'))
)
WITH CHECK (
 (entry_kind='room' AND private.bite_can(property_id,'folios'))
 OR (entry_kind='pos' AND private.bite_restaurant_staff_can(restaurant_id,'restaurant_pos'))
);
