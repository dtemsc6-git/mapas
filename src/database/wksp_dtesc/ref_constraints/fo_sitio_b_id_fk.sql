alter table wksp_dtesc.sgt_enlaces_fo
    add constraint fo_sitio_b_id_fk
        foreign key ( sitio_id_b )
            references wksp_dtesc.sgt_sitios ( id )
        enable;


-- sqlcl_snapshot {"hash":"d1c8835112e688950b02bbdf6b8dc095847e7d3d","type":"REF_CONSTRAINT","name":"FO_SITIO_B_ID_FK","schemaName":"WKSP_DTESC","sxml":""}