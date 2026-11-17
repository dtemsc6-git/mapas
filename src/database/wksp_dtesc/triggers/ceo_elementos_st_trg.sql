create or replace editionable trigger wksp_dtesc.ceo_elementos_st_trg before
    insert or update on wksp_dtesc.sgt_ceo_elementos
    for each row
begin 
    --actualizar info de  
    if inserting then
        :new.creado_el := sysdate;
        :new.creado_por := nvl(wwv_flow.g_user, user);
        :new.modificado_el := sysdate;
        :new.modificado_por := nvl(wwv_flow.g_user, user);
    elsif updating then
        :new.modificado_el := sysdate;
        :new.modificado_por := nvl(wwv_flow.g_user, user);
    end if;
end;
/

alter trigger wksp_dtesc.ceo_elementos_st_trg enable;


-- sqlcl_snapshot {"hash":"85aceddf3bfce1276bb72463f1f0c99913512e76","type":"TRIGGER","name":"CEO_ELEMENTOS_ST_TRG","schemaName":"WKSP_DTESC","sxml":""}