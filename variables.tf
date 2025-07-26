variable "tenancy_ocid" {}
variable "user_ocid" {}
variable "fingerprint" {}
variable "private_key_path" {}
variable "region" {}
variable "compartment_ocid" {}
variable "ssh_public_key_path" {}
variable "vm_shape" {
  default = "VM.Standard.A1.Flex"
}
