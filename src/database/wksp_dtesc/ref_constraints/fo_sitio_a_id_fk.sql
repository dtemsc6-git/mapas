alter table wksp_dtesc.sgt_enlaces_fo
    add constraint fo_sitio_a_id_fk
        foreign key ( sitio_id_a )
            references wksp_dtesc.sgt_sitios ( id )
        enable;


-- sqlcl_snapshot {"hash":"c5f90c946996a86da8cc631da9d74ea324826cbe","type":"REF_CONSTRAINT","name":"FO_SITIO_A_ID_FK","schemaName":"WKSP_DTESC","sxml":""}