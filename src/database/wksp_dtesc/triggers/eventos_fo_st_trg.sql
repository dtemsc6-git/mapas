create or replace editionable trigger wksp_dtesc.eventos_fo_st_trg before
    insert or update on wksp_dtesc.sgt_eventos_fo
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

alter trigger wksp_dtesc.eventos_fo_st_trg enable;


-- sqlcl_snapshot {"hash":"94bfaeeb01a9113886a8ca69d1e971528377adb1","type":"TRIGGER","name":"EVENTOS_FO_ST_TRG","schemaName":"WKSP_DTESC","sxml":""}