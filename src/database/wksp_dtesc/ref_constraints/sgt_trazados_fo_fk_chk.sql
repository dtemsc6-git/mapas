alter table wksp_dtesc.sgt_trazados_fo
    add constraint sgt_trazados_fo_fk_chk
        foreign key ( fo_id )
            references wksp_dtesc.sgt_enlaces_fo ( id )
        enable;


-- sqlcl_snapshot {"hash":"95f5785251b185c1a25faea62ea3ce022e085cb5","type":"REF_CONSTRAINT","name":"SGT_TRAZADOS_FO_FK_CHK","schemaName":"WKSP_DTESC","sxml":""}