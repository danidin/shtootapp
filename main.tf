provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
}

resource "oci_core_virtual_network" "vcn" {
  cidr_block     = "10.0.0.0/16"
  display_name   = "shtootapp-vcn"
  compartment_id = var.compartment_ocid
  dns_label = "shtoot"
  compartment_id = var.compartment_ocid
}

resource "oci_core_internet_gateway" "igw" {
  compartment_id = var.compartment_ocid
  display_name   = "shtootapp-igw"
  vcn_id         = oci_core_virtual_network.vcn.id
}

resource "oci_core_route_table" "public_rt" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_virtual_network.vcn.id
  display_name   = "shtootapp-public-rt"
  route_rules {
    network_entity_id = oci_core_internet_gateway.igw.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}

resource "oci_core_subnet" "subnet" {
  cidr_block        = "10.0.0.0/24"
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_virtual_network.vcn.id
  display_name      = "shtootapp-subnet"
  route_table_id    = oci_core_route_table.public_rt.id
  dns_label         = "shtootnet"
  dns_label = "apps"
  prohibit_public_ip_on_vnic = true
  security_list_ids = [oci_core_virtual_network.vcn.default_security_list_id]
}

resource "oci_core_instance" "partzoof" {
  display_name     = "partzoof"
  compartment_id   = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  shape            = var.vm_shape
  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu.images[0].id
  }
  create_vnic_details {
    subnet_id        = oci_core_subnet.subnet.id
    assign_public_ip = false
    hostname_label = "partzoof"
  }
  metadata = {
    ssh_authorized_keys = file(var.ssh_public_key_path)
  }
}

resource "oci_core_instance" "ozen" {
  display_name     = "ozen"
  compartment_id   = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  shape            = var.vm_shape
  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu.images[0].id
  }
  create_vnic_details {
    subnet_id        = oci_core_subnet.subnet.id
    assign_public_ip = false
    hostname_label = "ozen"
  }
  metadata = {
    ssh_authorized_keys = file(var.ssh_public_key_path)
  }
}

resource "oci_core_instance" "ozen_gateway" {
  display_name     = "ozen-gateway"
  compartment_id   = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  shape            = var.vm_shape
  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu.images[0].id
  }
  create_vnic_details {
    subnet_id        = oci_core_subnet.subnet.id
    assign_public_ip = true
    hostname_label = "ozen-gateway"
  }
  metadata = {
    ssh_authorized_keys = file(var.ssh_public_key_path)
  }
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_ocid
}

data "oci_core_images" "ubuntu" {
  compartment_id = var.compartment_ocid
  operating_system = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape = var.vm_shape
  sort_by = "TIMECREATED"
  sort_order = "DESC"
}
